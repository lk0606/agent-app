/**
 * Agent 端到端回归：`pnpm run evals:run`。
 * 读 evals/cases 下单个 json（默认 basic-agent-cases.json）→ TaskRunner → 断言 → 写 evals/reports/。
 *
 * CLI 示例：
 *   pnpm run evals:run
 *   pnpm run evals:run -- --id search-docs-city
 *   pnpm run evals:run -- --id=search-docs-city-zh
 *   pnpm run evals:run -- evals/cases/basic-agent-cases.json --id search-docs-city
 *
 * 用例增多、拆多文件时的策略见 docs/evals-and-replay.md §用例组织策略。
 */
import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { createAgentRuntime } from "../app/create-agent-runtime.js";
import { loadConfig } from "../config/env.js";
import { verifyPgConnection } from "../db/pg-client.js";
import { TokenHubEmbeddingClient } from "../llm/embedding-client.js";
import { buildAndStoreDocumentIndex } from "../rag/build-document-index.js";
import { PostgresDocumentChunkStore } from "../rag/document-chunk-store.js";
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
  /** 最终回答里不得出现这些词（小写比较），用于防幻觉泄露等 */
  forbiddenKeywords?: string[];
  expectedErrorCode?: string;
  expectedTaskStatus?: "succeeded" | "failed";
  /** 仅统计 status=succeeded 的工具次数；失败尝试（如安全拦截）不计入 */
  maxToolCalls?: number;
  /** 仅当 SEARCH_DOCS_MODE 为所列值之一时才跑该 case（如向量同义检索） */
  requiresSearchDocsMode?: Array<"keyword" | "vector" | "hybrid">;
}

interface EvalToolCallSnapshot {
  toolName: string;
  input: string;
  output: string;
  status: "succeeded" | "failed";
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
  toolCalls: EvalToolCallSnapshot[];
}

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 解析 `evals:run` 的 argv：可选 cases 文件路径 + `--id <caseId>` / `--id=<caseId>` */
function parseEvalCliArgs(argv: string[]): { casesPath: string | null; caseId: string | null } {
  let casesPath: string | null = null;
  let caseId: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === undefined) {
      continue;
    }

    // pnpm/npm 可能把分隔用的 `--` 原样传给脚本，直接忽略
    if (arg === "--") {
      continue;
    }

    if (arg === "--id") {
      const value = argv[index + 1];

      if (!value || value.startsWith("--")) {
        throw new Error('Missing value for --id. Example: pnpm run evals:run -- --id search-docs-city');
      }

      caseId = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--id=")) {
      caseId = arg.slice("--id=".length);

      if (caseId.length === 0) {
        throw new Error('Empty --id=. Example: pnpm run evals:run -- --id=search-docs-city');
      }

      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown eval flag: ${arg}. Supported: --id <caseId>`);
    }

    // 第一个非 flag 参数当作 cases json 路径；其余位置参数拒绝，避免静默忽略
    if (casesPath !== null) {
      throw new Error(`Unexpected argument: ${arg}. Only one cases file path is allowed.`);
    }

    casesPath = arg;
  }

  return { casesPath, caseId };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { runner, logger, memory, pool } = createAgentRuntime(config);

  await verifyPgConnection(pool);
  await ensureRagIndexIfNeeded(config, pool);
  // 未连上 DB 时 TaskRunner 会秒失败且 errorCode 全是 INTERNAL_ERROR，先预检便于排查。
  const { casesPath: casesPathArg, caseId } = parseEvalCliArgs(process.argv.slice(2));
  const casesPath = casesPathArg ?? path.join(apiRoot, "evals/cases/basic-agent-cases.json");
  const reportDir = path.join(apiRoot, "evals/reports");

  let cases = (await loadCases(casesPath)).filter((testCase) => shouldRunEvalCase(testCase, config.searchDocsMode));

  // --id：只跑指定 case；找不到则直接失败（区分「模式 skip」与「id 写错」）
  if (caseId) {
    const matched = cases.filter((testCase) => testCase.id === caseId);

    if (matched.length === 0) {
      const allIds = (await loadCases(casesPath)).map((item) => item.id);
      const known = allIds.includes(caseId);
      throw new Error(
        known
          ? `Eval case "${caseId}" is skipped for SEARCH_DOCS_MODE=${config.searchDocsMode}. Try vector|hybrid.`
          : `Eval case "${caseId}" not found in ${casesPath}. Known ids: ${allIds.join(", ")}`,
      );
    }

    cases = matched;
  }

  const results: EvalCaseResult[] = [];

  for (const testCase of cases) {
    const taskId = `eval-${testCase.id}-${Date.now()}`;
    const startedAt = Date.now();
    logger.info("Eval case started", { caseId: testCase.id, taskId });

    let summary: string | null = null;
    let toolCalls: EvalCaseResult["toolCalls"] = [];
    let taskStatus: EvalCaseResult["taskStatus"] = "succeeded";
    let errorCode: string | null = null;
    let assertTaskId = taskId;

    try {
      const result = await runEvalCase(testCase, taskId, runner, memory);

      summary = result.summary;
      toolCalls = result.toolCalls;
      assertTaskId = result.assertTaskId;
    } catch (error: unknown) {
      taskStatus = "failed";
      errorCode = classifyError(error).code;

      // 工具失败时 Planner 会 throw，内存 toolCalls 为空；从 DB 还原含 failed 的尝试记录。
      if (toolCalls.length === 0) {
        toolCalls = await loadToolCallsFromDb(memory, assertTaskId);
      }
    }

    if (toolCalls.length === 0) {
      toolCalls = await loadToolCallsFromDb(memory, assertTaskId);
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

interface RunEvalCaseResult {
  summary: string | null;
  toolCalls: EvalToolCallSnapshot[];
  assertTaskId: string;
}

async function runEvalCase(
  testCase: EvalCase,
  taskId: string,
  runner: ReturnType<typeof createAgentRuntime>["runner"],
  memory: ReturnType<typeof createAgentRuntime>["memory"],
): Promise<RunEvalCaseResult> {
  if (testCase.steps) {
    // 多轮：共用同一 sessionId，每轮独立 taskId；断言只看最后一轮的 summary / toolCalls。
    const sessionId = randomUUID();
    await memory.createSession({ id: sessionId });

    let lastResult: AgentResponse | null = null;
    let assertTaskId = taskId;

    for (const [index, stepInput] of testCase.steps.entries()) {
      assertTaskId = `${taskId}-step-${index + 1}`;
      lastResult = await runner.run({
        taskId: assertTaskId,
        sessionId,
        input: stepInput,
      });
    }

    if (!lastResult) {
      throw new Error(`Eval case "${testCase.id}" steps produced no result.`);
    }

    return {
      summary: lastResult.summary,
      toolCalls: lastResult.toolCalls.map((call) => ({ ...call, status: "succeeded" as const })),
      assertTaskId,
    };
  }

  const result = await runner.run({
    taskId,
    input: testCase.input!,
  });

  return {
    summary: result.summary,
    toolCalls: result.toolCalls.map((call) => ({ ...call, status: "succeeded" as const })),
    assertTaskId: taskId,
  };
}

async function loadToolCallsFromDb(
  memory: ReturnType<typeof createAgentRuntime>["memory"],
  taskId: string,
): Promise<EvalToolCallSnapshot[]> {
  const records = await memory.listTaskToolCalls(taskId);

  return records.map((record) => ({
    toolName: record.toolName,
    input: record.toolInput,
    output: record.toolOutput ?? record.errorMessage ?? "",
    status: record.status === "succeeded" ? "succeeded" : "failed",
  }));
}

function evaluateCase(
  testCase: EvalCase,
  summary: string | null,
  toolCalls: EvalToolCallSnapshot[],
  taskStatus: "succeeded" | "failed",
  errorCode: string | null,
): string[] {
  const failures: string[] = [];
  const toolNames = toolCalls.map((item) => item.toolName);
  const succeededToolCalls = toolCalls.filter((item) => item.status === "succeeded");
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

  for (const keyword of testCase.forbiddenKeywords ?? []) {
    if (normalizedSummary.includes(keyword.toLowerCase())) {
      failures.push(`Forbidden keyword "${keyword}" was found in summary.`);
    }
  }

  if (typeof testCase.maxToolCalls === "number" && succeededToolCalls.length > testCase.maxToolCalls) {
    failures.push(
      `Successful tool call count ${succeededToolCalls.length} exceeded limit ${testCase.maxToolCalls}.`,
    );
  }

  return failures;
}

function shouldRunEvalCase(testCase: EvalCase, searchDocsMode: ReturnType<typeof loadConfig>["searchDocsMode"]): boolean {
  if (!testCase.requiresSearchDocsMode || testCase.requiresSearchDocsMode.length === 0) {
    return true;
  }

  return testCase.requiresSearchDocsMode.includes(searchDocsMode);
}

/** vector/hybrid 模式且 document_chunks 为空时自动建索引，避免 search-docs-city-zh 等 case 误 fail */
async function ensureRagIndexIfNeeded(config: ReturnType<typeof loadConfig>, pool: Pool): Promise<void> {
  if (config.searchDocsMode === "keyword") {
    return;
  }

  const store = new PostgresDocumentChunkStore(pool);
  const existingCount = await store.count();

  if (existingCount > 0) {
    return;
  }

  console.log("document_chunks is empty; building vector index before evals...");

  const embeddingClient = new TokenHubEmbeddingClient({
    apiKey: config.hunyuanApiKey,
    model: config.hunyuanEmbeddingModel,
    baseURL: config.hunyuanBaseUrl,
  });

  const result = await buildAndStoreDocumentIndex(pool, embeddingClient, {
    rootDir: config.readFileRootDir,
    allowedExtensions: config.readFileAllowedExtensions,
    deniedBasenames: config.readFileDeniedBasenames,
    chunkChars: config.searchDocsChunkChars,
  });

  console.log(`Vector index ready: ${result.chunkCount} chunks`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
