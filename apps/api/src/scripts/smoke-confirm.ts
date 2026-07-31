/**
 * E.10 人工确认手测脚本：SSE 触发 write_file → awaiting_confirmation → approve/reject。
 * 用法：先 `pnpm run dev:server`（CONFIRMATION_AUTO_APPROVE 须为 false），另开终端：
 *   pnpm run smoke:confirm
 *   pnpm run smoke:confirm -- --decision=reject
 *
 * 常规执行顺序（跨模块）：
 * 1. POST /agent/stream（钉死 write_file）→ SSE awaiting_confirmation
 * 2. GET /tasks/:id 验 pendingConfirmation → POST .../confirm
 * 3. 流继续 done → 再 GET 断言 tool_calls / 磁盘
 *
 * 本文件执行链路：见 main 内步骤 [1]…[4]
 *   [1] 起 SSE → [2] 读到 awaiting 后 confirm → [3] 等流结束 → [4] 按 decision 断言
 */
import "dotenv/config";

import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.SMOKE_API_BASE_URL ?? "http://127.0.0.1:3000";
// 例：pnpm run smoke:confirm -- --decision=reject → 走拒绝断言分支
const decisionArg = process.argv.find((arg) => arg.startsWith("--decision="));
const decision = (decisionArg?.slice("--decision=".length) ?? "approve") as "approve" | "reject";
// 分文件避免 approve/reject 互相覆盖；测完 approve 会 unlink
const fixtureName = decision === "approve" ? "hitl-smoke-approve.txt" : "hitl-smoke-reject.txt";
const fixtureRoot =
  process.env.READ_FILE_ROOT_DIR ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../evals/fixtures");
const fixturePath = path.join(fixtureRoot, fixtureName);
const marker = `hello-hitl-${decision}-${Date.now()}`;

async function main(): Promise<void> {
  if (decision !== "approve" && decision !== "reject") {
    throw new Error(`Invalid --decision=${decision}; use approve or reject`);
  }

  try {
    await unlink(fixturePath);
  } catch {
    // 上次残留不存在即可；其它错误忽略会让后续断言更清晰（文件应不存在）
  }

  console.log(`Starting write_file via SSE at ${baseUrl} (decision=${decision}) ...`);

  // [1] 钉死 write_file：与 E.8 smoke:cancel 钉死 wait 同理，否则模型可能口头答应不调工具
  const response = await fetch(`${baseUrl}/agent/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: `请务必调用 write_file 工具，把内容 ${marker} 写入相对路径 ${fixtureName}，完成后一句话确认。`,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`SSE start failed: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let taskId: string | null = null;
  let sawAwaiting = false;
  let confirmPosted = false;
  let sawDone = false;
  let sawToolStart = false;
  let finalErrorCode: string | null = null;

  const readLoop = async () => {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        const eventMatch = chunk.match(/^event:\s*(.+)$/m);
        const dataMatch = chunk.match(/^data:\s*(.+)$/m);

        if (!eventMatch || !dataMatch) {
          continue;
        }

        const eventName = eventMatch[1]!.trim();
        const payload = JSON.parse(dataMatch[1]!) as {
          type: string;
          taskId?: string;
          toolName?: string;
          code?: string;
        };

        if (typeof payload.taskId === "string" && !taskId) {
          taskId = payload.taskId;
          console.log(`taskId=${taskId}`);
        }

        console.log(`SSE event: ${eventName}`);

        if (payload.type === "awaiting_confirmation" && payload.toolName === "write_file") {
          sawAwaiting = true;
        }

        // approve 路径必须出现；reject 路径断言时禁止出现
        if (payload.type === "tool_start" && payload.toolName === "write_file") {
          sawToolStart = true;
        }

        if (payload.type === "error") {
          finalErrorCode = payload.code ?? null;
        }

        if (payload.type === "done") {
          sawDone = true;
        }

        if (sawAwaiting && taskId && !confirmPosted) {
          confirmPosted = true;

          // [2] 挂起窗口内先验 GET：status + pendingConfirmation，再 POST confirm（对齐手测场景 A/B）
          const pendingRes = await fetch(`${baseUrl}/tasks/${taskId}`);
          const pendingBody = (await pendingRes.json()) as {
            task: { status: string };
            pendingConfirmation: { toolName: string } | null;
          };

          console.log("while awaiting:", {
            status: pendingBody.task.status,
            pendingConfirmation: pendingBody.pendingConfirmation,
          });

          if (pendingBody.task.status !== "awaiting_confirmation") {
            throw new Error(`Expected awaiting_confirmation, got ${pendingBody.task.status}`);
          }

          if (pendingBody.pendingConfirmation?.toolName !== "write_file") {
            throw new Error("pendingConfirmation.toolName is not write_file");
          }

          console.log(`Posting confirm decision=${decision} ...`);
          const confirmRes = await fetch(`${baseUrl}/tasks/${taskId}/confirm`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ decision }),
          });
          const confirmBody = (await confirmRes.json()) as { accepted?: boolean };
          console.log("confirm response:", confirmBody);

          if (!confirmBody.accepted) {
            throw new Error("Confirm API returned accepted=false");
          }
        }
      }
    }
  };

  await readLoop();

  // [3] 流已结束（done 或 error）；给 TaskRunner 落库一点时间再断言
  if (!taskId) {
    throw new Error("Never received taskId from SSE.");
  }

  if (!sawAwaiting) {
    throw new Error(
      "Model did not emit awaiting_confirmation for write_file. Retry, or check tool registration / prompt.",
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 500));

  const taskRes = await fetch(`${baseUrl}/tasks/${taskId}`);
  const taskBody = (await taskRes.json()) as {
    task: { status: string; summary: string | null };
    toolCalls: Array<{ toolName: string; status: string; errorCode: string | null }>;
    plannerTrace: Array<{ outcome: string; toolName: string | null }>;
    pendingConfirmation: unknown;
    metrics: { llmCallCount: number } | null;
  };

  console.log("final task:", {
    status: taskBody.task.status,
    tools: taskBody.toolCalls,
    plannerOutcomes: taskBody.plannerTrace.map((step) => step.outcome),
    pendingConfirmation: taskBody.pendingConfirmation,
    llmCallCount: taskBody.metrics?.llmCallCount ?? null,
    sawDone,
    sawToolStart,
    sseErrorCode: finalErrorCode,
  });

  if (taskBody.task.status !== "succeeded") {
    throw new Error(`Expected status=succeeded, got ${taskBody.task.status}`);
  }

  if (taskBody.pendingConfirmation !== null) {
    throw new Error("pendingConfirmation should be null after settle");
  }

  const writeCall = taskBody.toolCalls.find((call) => call.toolName === "write_file");

  if (!writeCall) {
    throw new Error("Missing write_file tool_calls row");
  }

  // [4] 按 decision 分支断言：approve 必须写盘；reject 禁止 tool_start / 落盘
  if (decision === "approve") {
    if (!sawToolStart) {
      throw new Error("Expected tool_start after approve");
    }

    if (writeCall.status !== "succeeded") {
      throw new Error(`Expected tool succeeded, got ${writeCall.status}`);
    }

    const written = await readFile(fixturePath, "utf8");

    if (!written.includes(marker)) {
      throw new Error(`Fixture missing marker content: ${fixturePath}`);
    }

    console.log(`Wrote file OK: ${fixturePath}`);
    // 测完删掉，避免污染 evals/fixtures
    await unlink(fixturePath);
  } else {
    // [4] reject：禁止 tool_start / 禁止落盘；DB 为 skipped + HUMAN_REJECTED
    if (sawToolStart) {
      throw new Error("Reject path must not emit tool_start for write_file");
    }

    if (writeCall.status !== "skipped" || writeCall.errorCode !== "HUMAN_REJECTED") {
      throw new Error(
        `Expected skipped/HUMAN_REJECTED, got ${writeCall.status}/${writeCall.errorCode}`,
      );
    }

    try {
      await readFile(fixturePath, "utf8");
      throw new Error("Reject path must not create the fixture file");
    } catch (error: unknown) {
      // 期望 ENOENT；其它错误（权限等）仍抛出
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  console.log(`smoke:confirm OK (${decision})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
