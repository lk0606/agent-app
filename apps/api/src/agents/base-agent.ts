/**
 * Agent 抽象层：定义一次任务请求的入参/出参，以及 plan() 运行时需要的依赖。
 * 当前唯一实现是 PlannerAgent（多步 plan → 可选 tool → answer）。
 */
import type { AgentStreamEvent } from "@agent-app/api-contract";
import type { LlmClient } from "../llm/llm-client.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { TaskMetricsCollector } from "../runtime/task-metrics.js";
import type { Logger } from "../shared/logger.js";
import type { Tool } from "../tools/tool.js";

export interface AgentContext {
  tools: Tool[];
  memory: MemoryStore;
  llm: LlmClient;
  logger: Logger;
  /** 可选：POST /agent/stream 注入，用于推送 SSE 事件 */
  emitStream?: (event: AgentStreamEvent) => void;
  /**
   * E.8：任务取消/超时信号。Planner 在步进边界 throwIfAborted；
   * 来源为 TaskRunner 内部 AbortController（cancel API / 客户端断开 / 超时共用）。
   */
  signal?: AbortSignal;
  /**
   * E.9：任务级 token/耗时聚合器。LLM 经 onLlmCall 写入；结束由 TaskRunner 落库 task_metrics。
   * 与 plannerTrace（决策链）、OpenTelemetry traceId 都不是同一概念。
   */
  metrics?: TaskMetricsCollector;
}

export interface AgentRequest {
  taskId: string;
  sessionId?: string | null;
  input: string;
}

export interface AgentResponse {
  summary: string;
  toolCalls: Array<{
    toolName: string;
    input: string;
    output: string;
  }>;
}

export interface Agent {
  plan(request: AgentRequest, context: AgentContext): Promise<AgentResponse>;
}
