import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createAgentRuntime } from "../app/create-agent-runtime.js";
import { loadConfig } from "../config/env.js";

interface EvalCase {
  id: string;
  input: string;
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
  const { runner, logger, pool } = createAgentRuntime(config);
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
      const result = await runner.run({
        taskId,
        input: testCase.input,
      });

      summary = result.summary;
      toolCalls = result.toolCalls;
    } catch (error: unknown) {
      taskStatus = "failed";
      errorCode = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code ?? "") : null;
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
}

async function loadCases(filePath: string): Promise<EvalCase[]> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as EvalCase[];
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
