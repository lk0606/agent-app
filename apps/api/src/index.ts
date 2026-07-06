/**
 * CLI 单次演示入口（`pnpm run dev`）。
 * 不监听 HTTP 端口；联调前端请用 `pnpm run dev:server` → server.ts。
 */
import "dotenv/config";

import { createAgentRuntime } from "./app/create-agent-runtime.js";
import { loadConfig } from "./config/env.js";
import { classifyError } from "./shared/app-error.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { logger, runner, pool } = createAgentRuntime(config);

  const result = await runner.run({
    taskId: "demo-task",
    input: "请打开 https://cloud.tencent.com/document/product/1729/111007 并简要总结这页主要讲什么。",
  });

  logger.info("Final result", result);
  await pool.end();
}

main().catch((error: unknown) => {
  const appError = classifyError(error);
  console.error(
    JSON.stringify(
      {
        code: appError.code,
        message: appError.message,
        details: appError.details,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
