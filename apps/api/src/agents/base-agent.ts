/**
 * Agent 抽象层：定义一次任务请求的入参/出参，以及 plan() 运行时需要的依赖。
 *
 * 实现：
 * - PlannerAgent：多步 plan → 可选 tool → answer（也可被 Supervisor 以工具子集调用）
 * - SupervisorAgent（E.12）：先路由到专家，再委托 PlannerAgent
 */
import type { AgentStreamEvent } from "@agent-app/api-contract";
import type { LlmClient } from "../llm/llm-client.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { ConfirmationRegistry } from "../runtime/confirmation-registry.js";
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
  /**
   * E.10：人工确认挂起表。requiresConfirmation 工具在 execute 前 wait；
   * HTTP confirm API 调 resolve。autoApprove 时 eval 不挂死。
   */
  confirmations?: ConfirmationRegistry;
  /** E.10：true 时跳过人工挂起，立刻 approve（evals / smoke 无 HTTP 确认方） */
  confirmationAutoApprove?: boolean;
  /**
   * E.12：Supervisor 已占用 step 1（outcome=routed）时，专家 Planner 落库/SSE 的 step 偏移。
   * 例：stepOffset=1 → 专家内部第 1 步写入 planner_steps.step=2。
   * 单 Agent 模式默认 0，行为与改前一致。
   */
  stepOffset?: number;
  /**
   * E.12.x：仅 docs/files 专家可请求升级给 general；general 本身为全量工具，禁止再次升级。
   * 例：files 收到“先查文档再写文件”但没有 search_docs → 请求升级，而非假装完成。
   */
  allowEscalationToGeneral?: boolean;
  /**
   * E.12.x：general 的业务工具名，用来识别“当前专家缺少、但 general 能执行”的选择。
   * 例：files 选 time（当前没有、general 有）→ 自动升级；选 imaginary_tool（全局也没有）→ TOOL_ERROR。
   */
  generalToolNames?: readonly string[];
  /**
   * E.12.x：升级后的 general 可在工具预算内继续规划，完成跨能力任务的后续动作。
   * 例：先 time 取时间，再 write_file 写入；普通单专家任务仍保持一次工具后回答的既有行为。
   */
  continuePlanningAfterToolCalls?: boolean;
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
