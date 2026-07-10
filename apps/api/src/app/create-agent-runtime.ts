/**
 * 依赖注入：把 Config、DB、LLM、Tools、Agent、TaskRunner 组装成可运行运行时。
 * HTTP(server.ts) 与脚本(run-evals.ts) 都从这里拿同一套实例，保证行为一致。
 */
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
import { ListDirTool } from "../tools/list-dir-tool.js";
import { ReadFileTool } from "../tools/read-file-tool.js";
import { SearchDocsTool } from "../tools/search-docs-tool.js";
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
  // 工具在 create-agent-runtime 注册；Planner 通过 function calling 按 name 选用
  const tools = [
    new TimeTool(),
    new HttpFetchTool({
      timeoutMs: config.httpFetchTimeoutMs,
      maxChars: config.httpFetchMaxChars,
      retries: config.httpFetchRetries,
      maxResponseBytes: config.httpFetchMaxResponseBytes,
      allowedContentTypes: config.httpFetchAllowedContentTypes,
      allowHosts: config.httpFetchAllowHosts,
      denyHosts: config.httpFetchDenyHosts,
    }),
    new EchoTool(),
    new ReadFileTool({
      rootDir: config.readFileRootDir,
      maxBytes: config.readFileMaxBytes,
      allowedExtensions: config.readFileAllowedExtensions,
      deniedBasenames: config.readFileDeniedBasenames,
    }),
    // list_dir 与 read_file 共用沙箱根目录；注册后须重启 dev:server 才进 HTTP 进程
    new ListDirTool({
      rootDir: config.readFileRootDir,
      maxEntries: config.listDirMaxEntries,
    }),
    // search_docs 与 read_file 共用沙箱与扩展名白名单；跨文件检索用本工具，路径明确用 read_file
    new SearchDocsTool({
      rootDir: config.readFileRootDir,
      allowedExtensions: config.readFileAllowedExtensions,
      deniedBasenames: config.readFileDeniedBasenames,
      maxResults: config.searchDocsMaxResults,
      chunkChars: config.searchDocsChunkChars,
    }),
  ];
  const agent = new PlannerAgent({
    maxSteps: config.agentMaxSteps,
    toolCallBudget: config.agentToolCallBudget,
    sessionHistoryMessageLimit: config.sessionHistoryMessageLimit,
    sessionHistoryCharBudget: config.sessionHistoryCharBudget,
  });
  const runner = new TaskRunner({ agent, tools, memory, llm, logger });

  return {
    logger,
    memory,
    runner,
    pool,
  };
}
