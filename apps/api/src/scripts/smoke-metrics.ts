/**
 * E.9 冒烟：不经 HTTP，直接 TaskRunner 跑一条 time 任务，打印 task_metrics。
 * 用法：`pnpm --filter @agent-app/api exec dotenv -e .env -- tsx src/scripts/smoke-metrics.ts`
 * 或根目录：`pnpm --filter @agent-app/api exec tsx --env-file=.env src/scripts/smoke-metrics.ts`
 */
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { createAgentRuntime } from "../app/create-agent-runtime.js";
import { loadConfig } from "../config/env.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { runner, memory, pool, logger } = createAgentRuntime(config);
  const taskId = randomUUID();

  try {
    const result = await runner.run({
      taskId,
      input: "请调用 time 工具，用一句话告诉我当前时间",
    });
    logger.info("Smoke metrics run succeeded", { taskId, summary: result.summary });
  } catch (error: unknown) {
    logger.error("Smoke metrics run failed", {
      taskId,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const metrics = await memory.getTaskMetrics(taskId);
  console.log(JSON.stringify({ taskId, metrics }, null, 2));

  if (!metrics || metrics.llmCallCount < 1) {
    throw new Error("Expected metrics.llmCallCount >= 1");
  }

  await pool.end();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
