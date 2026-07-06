/**
 * Agent 端到端回归：`pnpm run evals:run`。
 * 读 evals/cases/*.json → 跑 TaskRunner → 断言工具/关键词/失败码 → 写 evals/reports/。
 */
import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { randomUUID } from "node:crypto";

import { createAgentRuntime } from "../app/create-agent-runtime.js";
import { loadConfig } from "../config/env.js";
import { verifyPgConnection } from "../db/pg-client.js";
import { classifyError } from "../shared/app-error.js";
import type { AgentResponse } from "../agents/base-agent.js";

interface EvalCase {
  id: string;
  /** 单轮任务：与 steps 二选一 */
  input?: string;
  /** 多轮会话：同一 session 下按顺序执行，在最后一轮结果上断言；与 input 二选一 */
  steps?: string[];
  expectedTools?: string[];
  forbiddenTools?: string[];
  expectedKeywords?: string[];
  expectedErrorCode?: string;
  expectedTaskStatus?: "succeeded" | "failed";
  maxToolCalls?: number;
}

interface EvalCaseResult {
  id: string;
  taskId: string;
  passed: boolean;
  failures: string[];
  durationMs: number;
  summary: string | null;
  taskStatus: "succeeded" | "failed";
  errorCode: string | null;
  toolCalls: Array<{
    toolName: string;
    input: string;
    output: string;
  }>;
}

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main(): Promise<void> {
  const config = loadConfig();
  const { runner, logger, memory, pool } = createAgentRuntime(config);

  await verifyPgConnection(pool);
  // 未连上 DB 时 TaskRunner 会秒失败且 errorCode 全是 INTERNAL_ERROR，先预检便于排查。
  const casesPath = process.argv[2] ?? path.join(apiRoot, "evals/cases/basic-agent-cases.json");
  const reportDir = path.join(apiRoot, "evals/reports");

  const cases = await loadCases(casesPath);
  const results: EvalCaseResult[] = [];

  for (const testCase of cases) {
    const taskId = `eval-${testCase.id}-${Date.now()}`;
    const startedAt = Date.now();
    logger.info("Eval case started", { caseId: testCase.id, taskId });

    let summary: string | null = null;
    let toolCalls: EvalCaseResult["toolCalls"] = [];
    let taskStatus: EvalCaseResult["taskStatus"] = "succeeded";
    let errorCode: string | null = null;

    try {
      const result = await runEvalCase(testCase, taskId, runner, memory);

      summary = result.summary;
      toolCalls = result.toolCalls;
    } catch (error: unknown) {
      taskStatus = "failed";
      errorCode = classifyError(error).code;
    }

    const durationMs = Date.now() - startedAt;
    const failures = evaluateCase(testCase, summary, toolCalls, taskStatus, errorCode);

    results.push({
      id: testCase.id,
      taskId,
      passed: failures.length === 0,
      failures,
      durationMs,
      summary,
      taskStatus,
      errorCode,
      toolCalls,
    });

    logger.info("Eval case finished", {
      caseId: testCase.id,
      taskId,
      passed: failures.length === 0,
      durationMs,
      failures,
    });
  }

  const report = {
    createdAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    results,
  };

  await mkdir(reportDir, { recursive: true });

  const filePath = path.join(reportDir, `eval-run-${Date.now()}.json`);
  await writeFile(filePath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({ reportPath: filePath, ...report }, null, 2));
  await pool.end();

  if (report.failed > 0) {
    // 有失败用例时非零退出，方便 CI / shell 脚本感知回归结果。
    process.exitCode = 1;
  }
}

async function loadCases(filePath: string): Promise<EvalCase[]> {
  const raw = await readFile(filePath, "utf8");
  const cases = JSON.parse(raw) as EvalCase[];

  // 每条 case 只能是「单轮 input」或「多轮 steps」之一，用 XOR 校验（见下方 hasInput === hasSteps）。
  for (const testCase of cases) {
    const hasInput = typeof testCase.input === "string" && testCase.input.trim().length > 0;
    const hasSteps = Array.isArray(testCase.steps) && testCase.steps.length > 0;

    // hasInput 与 hasSteps 同为 true/false 都非法：必须恰好一个有、一个没有。
    if (hasInput === hasSteps) {
      throw new Error(`Eval case "${testCase.id}" must have exactly one of "input" or "steps".`);
    }
  }

  return cases;
}

async function runEvalCase(
  testCase: EvalCase,
  taskId: string,
  runner: ReturnType<typeof createAgentRuntime>["runner"],
  memory: ReturnType<typeof createAgentRuntime>["memory"],
): Promise<AgentResponse> {
  if (testCase.steps) {
    // 多轮：共用同一 sessionId，每轮独立 taskId；断言只看最后一轮的 summary / toolCalls。
    const sessionId = randomUUID();
    await memory.createSession({ id: sessionId });

    let lastResult: AgentResponse | null = null;

    for (const [index, stepInput] of testCase.steps.entries()) {
      const stepTaskId = `${taskId}-step-${index + 1}`;
      lastResult = await runner.run({
        taskId: stepTaskId,
        sessionId,
        input: stepInput,
      });
    }

    if (!lastResult) {
      throw new Error(`Eval case "${testCase.id}" steps produced no result.`);
    }

    return lastResult;
  }

  return runner.run({
    taskId,
    input: testCase.input!,
  });
}

function evaluateCase(
  testCase: EvalCase,
  summary: string | null,
  toolCalls: Array<{ toolName: string; input: string; output: string }>,
  taskStatus: "succeeded" | "failed",
  errorCode: string | null,
): string[] {
  const failures: string[] = [];
  const toolNames = toolCalls.map((item) => item.toolName);
  const normalizedSummary = (summary ?? "").toLowerCase();

  if (testCase.expectedTaskStatus && taskStatus !== testCase.expectedTaskStatus) {
    failures.push(`Expected task status "${testCase.expectedTaskStatus}" but got "${taskStatus}".`);
  }

  if (testCase.expectedErrorCode && errorCode !== testCase.expectedErrorCode) {
    failures.push(`Expected error code "${testCase.expectedErrorCode}" but got "${errorCode}".`);
  }

  for (const toolName of testCase.expectedTools ?? []) {
    if (!toolNames.includes(toolName)) {
      failures.push(`Expected tool "${toolName}" was not used.`);
    }
  }

  for (const toolName of testCase.forbiddenTools ?? []) {
    if (toolNames.includes(toolName)) {
      failures.push(`Forbidden tool "${toolName}" was used.`);
    }
  }

  for (const keyword of testCase.expectedKeywords ?? []) {
    if (!normalizedSummary.includes(keyword.toLowerCase())) {
      failures.push(`Expected keyword "${keyword}" was not found in summary.`);
    }
  }

  if (typeof testCase.maxToolCalls === "number" && toolCalls.length > testCase.maxToolCalls) {
    failures.push(`Tool call count ${toolCalls.length} exceeded limit ${testCase.maxToolCalls}.`);
  }

  return failures;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
