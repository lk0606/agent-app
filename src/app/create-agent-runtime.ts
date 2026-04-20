import { PlannerAgent } from "../agents/planner-agent.js";
import type { AppConfig } from "../config/env.js";
import { getDatabaseConfig } from "../db/connection-config.js";
import { createPgPool } from "../db/pg-client.js";
import { HunyuanLlmClient } from "../llm/hunyuan-llm-client.js";
import { PostgresMemoryStore } from "../memory/postgres-memory-store.js";
import { TaskRunner } from "../runtime/task-runner.js";
import { createLogger } from "../shared/logger.js";
import { EchoTool } from "../tools/echo-tool.js";
import { HttpFetchTool } from "../tools/http-fetch-tool.js";
import { TimeTool } from "../tools/time-tool.js";

export function createAgentRuntime(config: AppConfig) {
  const logger = createLogger(config.appName);
  const database = getDatabaseConfig(config);
  const pool = createPgPool({
    connectionString: database.url,
  });
  const memory = new PostgresMemoryStore(pool);
  const llm = new HunyuanLlmClient({
    apiKey: config.hunyuanApiKey,
    model: config.hunyuanModel,
    baseURL: config.hunyuanBaseUrl,
  });
  const tools = [
    new TimeTool(),
    new HttpFetchTool({
      timeoutMs: config.httpFetchTimeoutMs,
      maxChars: config.httpFetchMaxChars,
      retries: config.httpFetchRetries,
    }),
    new EchoTool(),
  ];
  const agent = new PlannerAgent({
    maxSteps: config.agentMaxSteps,
  });
  const runner = new TaskRunner({ agent, tools, memory, llm, logger });

  return {
    logger,
    runner,
    pool,
  };
}
