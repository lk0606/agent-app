/**
 * LlmClient 接口：Agent 对模型的调用面。
 * - plan：决定是否 function calling（Planner 循环）
 * - answerWithTool：拿工具结果组织自然语言（可 stream）
 * - summarizeSession：把旧会话压成 summary 写回 sessions 表
 * - routeSpecialty：E.12 Supervisor 分诊（docs | files | general），与 plan 的工具选型 prompt 分离
 *
 * E.8.5：各 Request 可带 signal，混元 HTTP 中途可被 cancel/超时 abort。
 * E.9：各 Request 可带 onLlmCall，回报 token 用量与单次耗时（写入 task_metrics，非 traceId）。
 */
import type { LlmCallMetrics } from "../runtime/task-metrics.js";

export interface ToolDefinition {
  name: string;
  description: string;
}

/** E.12：Supervisor 可选专家 id；与 plannerTrace.routed 的 toolName 对齐 */
export type SpecialistId = "docs" | "files" | "general";

export interface RouteSpecialtyRequest {
  userInput: string;
  specialists: Array<{
    id: SpecialistId;
    description: string;
  }>;
  signal?: AbortSignal;
  onLlmCall?: (event: LlmCallMetrics) => void;
}

export interface PlannerDecision {
  needsTool: boolean;
  toolName: string | null;
  toolInput: string | null;
  draftAnswer: string;
}

export interface PlanRequest {
  sessionSummary?: string | null;
  conversationHistory: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
  }>;
  userInput: string;
  tools: ToolDefinition[];
  previousToolCalls: Array<{
    toolName: string;
    toolInput: string;
    toolOutput: string;
  }>;
  /** E.8.5：取消/超时时中止本次 plan 的 HTTP 请求 */
  signal?: AbortSignal;
  /** E.9：本次 plan HTTP 结束后回报用量（成功/失败/abort 都会尽量调用） */
  onLlmCall?: (event: LlmCallMetrics) => void;
}

export interface AnswerRequest {
  sessionSummary?: string | null;
  conversationHistory: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
  }>;
  userInput: string;
  toolName: string;
  toolInput: string;
  toolOutput: string;
  /** E.8.5：取消/超时时中止 answer 生成（含 stream） */
  signal?: AbortSignal;
  /** E.9：answer 调用结束后回报用量 */
  onLlmCall?: (event: LlmCallMetrics) => void;
}

export interface SessionSummaryRequest {
  existingSummary?: string | null;
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
  }>;
  currentUserInput: string;
  /** E.8.5：取消时中止摘要 LLM 调用 */
  signal?: AbortSignal;
  /** E.9：摘要调用结束后回报用量 */
  onLlmCall?: (event: LlmCallMetrics) => void;
}

export interface LlmStreamOptions {
  /** POST /agent/stream 注入：混元 stream: true 时按 delta 回调 */
  onToken?: (delta: string) => void;
}

export interface LlmClient {
  plan(input: PlanRequest): Promise<PlannerDecision>;
  answerWithTool(input: AnswerRequest, options?: LlmStreamOptions): Promise<string>;
  summarizeSession(input: SessionSummaryRequest): Promise<string>;
  /**
   * E.12：只做专家分诊，不执行工具。
   * 解析失败 / 未选 function 时实现方应回退 `general`（保守，避免锁死错误子集）。
   */
  routeSpecialty(input: RouteSpecialtyRequest): Promise<SpecialistId>;
}
