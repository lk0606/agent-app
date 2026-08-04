/**
 * 依赖注入：把 Config、DB、LLM、Tools、Agent、TaskRunner 组装成可运行运行时。
 * HTTP(server.ts) 与脚本(run-evals.ts) 都从这里拿同一套实例，保证行为一致。
 *
 * E.12：按 AGENT_ORCHESTRATION 选择 SupervisorAgent 或单 PlannerAgent 注入 TaskRunner。
 */
import { PlannerAgent } from "../agents/planner-agent.js";
import { SupervisorAgent } from "../agents/supervisor-agent.js";
import type { AppConfig } from "../config/env.js";
import { getDatabaseConfig } from "../db/connection-config.js";
import { createPgPool } from "../db/pg-client.js";
import { HunyuanLlmClient } from "../llm/hunyuan-llm-client.js";
import { TokenHubEmbeddingClient } from "../llm/embedding-client.js";
import { PostgresMemoryStore } from "../memory/postgres-memory-store.js";
import { PostgresDocumentChunkStore } from "../rag/document-chunk-store.js";
import { RunningTaskRegistry } from "../runtime/running-task-registry.js";
import { ConfirmationRegistry } from "../runtime/confirmation-registry.js";
import { TaskRunner } from "../runtime/task-runner.js";
import { createLogger } from "../shared/logger.js";
import { EchoTool } from "../tools/echo-tool.js";
import { HttpFetchTool } from "../tools/http-fetch-tool.js";
import { ListDirTool } from "../tools/list-dir-tool.js";
import { ReadFileTool } from "../tools/read-file-tool.js";
import { SearchDocsTool } from "../tools/search-docs-tool.js";
import { TimeTool } from "../tools/time-tool.js";
import { WaitTool } from "../tools/wait-tool.js";
import { WriteFileTool } from "../tools/write-file-tool.js";

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
  const embeddingClient =
    config.searchDocsMode === "keyword"
      ? null
      : new TokenHubEmbeddingClient({
          apiKey: config.hunyuanApiKey,
          model: config.hunyuanEmbeddingModel,
          baseURL: config.hunyuanBaseUrl,
        });
  const chunkStore = config.searchDocsMode === "keyword" ? null : new PostgresDocumentChunkStore(pool);
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
    // search_docs：keyword 仅内存切块；vector/hybrid 需先 pnpm run rag:index 写 document_chunks
    new SearchDocsTool({
      rootDir: config.readFileRootDir,
      allowedExtensions: config.readFileAllowedExtensions,
      deniedBasenames: config.readFileDeniedBasenames,
      maxResults: config.searchDocsMaxResults,
      chunkChars: config.searchDocsChunkChars,
      searchMode: config.searchDocsMode,
      embeddingClient,
      chunkStore,
    }),
    // E.8 手测取消：长等待可中断；日常任务勿滥用
    new WaitTool({
      maxSeconds: config.waitToolMaxSeconds,
    }),
    // E.10：沙箱写文件；requiresConfirmation=true → Planner 在 execute 前挂起等人批准
    // 与 read_file 共用 rootDir / 扩展名 / denylist；注册后须重启 dev:server
    new WriteFileTool({
      rootDir: config.readFileRootDir,
      maxBytes: config.readFileMaxBytes,
      allowedExtensions: config.readFileAllowedExtensions,
      deniedBasenames: config.readFileDeniedBasenames,
    }),
  ];
  const planner = new PlannerAgent({
    maxSteps: config.agentMaxSteps,
    toolCallBudget: config.agentToolCallBudget,
    sessionHistoryMessageLimit: config.sessionHistoryMessageLimit,
    sessionHistoryCharBudget: config.sessionHistoryCharBudget,
  });

  // E.12：supervisor = 路由 + 专家工具子集；single = 全量工具直跑 Planner（对比/救急）
  const agent =
    config.agentOrchestration === "single"
      ? planner
      : new SupervisorAgent({
          planner,
          specialists: {
            // docs：检索向；故意不含 write_file，缩小写盘误调面
            docs: tools.filter((tool) =>
              ["search_docs", "read_file", "list_dir"].includes(tool.name),
            ),
            // files：沙箱读写；不含 search_docs / http / time
            files: tools.filter((tool) =>
              ["list_dir", "read_file", "write_file"].includes(tool.name),
            ),
            // general：与现网一致，不确定意图必须落到这里
            general: tools,
          },
        });

  // E.8：进程内登记运行中任务的 AbortController，供 POST /tasks/:id/cancel
  const runningTasks = new RunningTaskRegistry();
  // E.10：进程内登记 awaiting_confirmation 的 Promise，供 POST /tasks/:id/confirm
  // 与 runningTasks 成对：cancel abort signal 会唤醒 wait；confirm 调 resolve
  const confirmations = new ConfirmationRegistry();
  const runner = new TaskRunner({
    agent,
    tools,
    memory,
    llm,
    logger,
    runningTasks,
    confirmations,
    // 默认 false（手测）；evals:run 在脚本里强制 env=1 后再 loadConfig
    confirmationAutoApprove: config.confirmationAutoApprove,
    defaultTimeoutMs: config.agentTaskTimeoutMs,
    // E.9：估算成本单价注入 TaskMetricsCollector
    metricsPricing: {
      promptPer1MUsd: config.llmPricePromptPer1MUsd,
      completionPer1MUsd: config.llmPriceCompletionPer1MUsd,
    },
  });

  return {
    logger,
    memory,
    runner,
    runningTasks,
    confirmations,
    pool,
  };
}
