import "dotenv/config";

import { PlannerAgent } from "./agents/planner-agent.js";
import { loadConfig } from "./config/env.js";
import { HunyuanLlmClient } from "./llm/hunyuan-llm-client.js";
import { InMemoryStore } from "./memory/in-memory-store.js";
import { TaskRunner } from "./runtime/task-runner.js";
import { createLogger } from "./shared/logger.js";
import { EchoTool } from "./tools/echo-tool.js";
import { HttpFetchTool } from "./tools/http-fetch-tool.js";
import { TimeTool } from "./tools/time-tool.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.appName);
  const memory = new InMemoryStore();
  const llm = new HunyuanLlmClient({
    apiKey: config.hunyuanApiKey,
    model: config.hunyuanModel,
    baseURL: config.hunyuanBaseUrl,
  });
  const tools = [new TimeTool(), new HttpFetchTool(), new EchoTool()];
  const agent = new PlannerAgent();
  const runner = new TaskRunner({ agent, tools, memory, llm, logger });

  const result = await runner.run({
    taskId: "demo-task",
    input: "请打开 https://cloud.tencent.com/document/product/1729/111007 并简要总结这页主要讲什么。",
  });

  logger.info("Final result", result);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
