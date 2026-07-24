/**
 * E.8 取消手测脚本：起一条「wait 15 秒」的 SSE 任务，等到 tool_start 后再 cancel。
 * 用法：先 `pnpm run dev:server`，另开终端 `pnpm run smoke:cancel`。
 *
 * 比「对 time 抢取消」可靠：wait 会睡十几秒，且按 100ms 切片检查 AbortSignal。
 */
import "dotenv/config";

const baseUrl = process.env.SMOKE_API_BASE_URL ?? "http://127.0.0.1:3000";

async function main(): Promise<void> {
  console.log(`Starting long wait via SSE at ${baseUrl} ...`);

  const response = await fetch(`${baseUrl}/agent/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: "请务必调用 wait 工具等待 15 秒，等待结束后只回复「完成」。",
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`SSE start failed: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let taskId: string | null = null;
  let sawWaitStart = false;
  let cancelPosted = false;
  let finalErrorCode: string | null = null;
  let sawDone = false;

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

        if (payload.type === "tool_start" && payload.toolName === "wait") {
          sawWaitStart = true;
        }

        if (payload.type === "error") {
          finalErrorCode = payload.code ?? null;
        }

        if (payload.type === "done") {
          sawDone = true;
        }

        // wait 一开始睡，立刻取消 —— 窗口有十几秒，不会抢不到
        if (sawWaitStart && taskId && !cancelPosted) {
          cancelPosted = true;
          console.log("Posting cancel while wait is running...");
          const cancelRes = await fetch(`${baseUrl}/tasks/${taskId}/cancel`, { method: "POST" });
          const cancelBody = (await cancelRes.json()) as { cancelled?: boolean };
          console.log("cancel response:", cancelBody);

          if (!cancelBody.cancelled) {
            throw new Error("Cancel API returned cancelled=false; is the task still running?");
          }
        }
      }
    }
  };

  await readLoop();

  if (!taskId) {
    throw new Error("Never received taskId from SSE.");
  }

  if (!sawWaitStart) {
    throw new Error(
      "Model did not call wait tool. Retry, or check Planner prompt / tool registration.",
    );
  }

  // 给 TaskRunner catch 落库一点时间
  await new Promise((resolve) => setTimeout(resolve, 500));

  const taskRes = await fetch(`${baseUrl}/tasks/${taskId}`);
  const taskBody = (await taskRes.json()) as {
    task: { status: string; errorCode: string | null };
  };

  console.log("final task:", {
    status: taskBody.task.status,
    errorCode: taskBody.task.errorCode,
    sseErrorCode: finalErrorCode,
    sawDone,
  });

  if (taskBody.task.status !== "cancelled") {
    throw new Error(`Expected status=cancelled, got ${taskBody.task.status}`);
  }

  if (taskBody.task.errorCode !== "CANCELLED") {
    throw new Error(`Expected errorCode=CANCELLED, got ${taskBody.task.errorCode}`);
  }

  console.log("smoke:cancel OK");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
