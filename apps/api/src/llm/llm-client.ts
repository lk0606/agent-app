/**
 * LlmClient 接口：PlannerAgent 对模型的三次调用。
 * - plan：决定是否 function calling
 * - answerWithTool：拿工具结果组织自然语言（可 stream）
 * - summarizeSession：把旧会话压成 summary 写回 sessions 表
 *
 * E.8.5：各 Request 可带 signal，混元 HTTP 中途可被 cancel/超时 abort。
 */
export interface ToolDefinition {
  name: string;
  description: string;
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
}

export interface LlmStreamOptions {
  /** POST /agent/stream 注入：混元 stream: true 时按 delta 回调 */
  onToken?: (delta: string) => void;
}

export interface LlmClient {
  plan(input: PlanRequest): Promise<PlannerDecision>;
  answerWithTool(input: AnswerRequest, options?: LlmStreamOptions): Promise<string>;
  summarizeSession(input: SessionSummaryRequest): Promise<string>;
}
