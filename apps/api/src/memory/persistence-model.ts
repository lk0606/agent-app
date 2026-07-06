/**
 * 持久化领域模型（TS 类型，非 DB schema 文件）。
 * 表结构见 apps/api/infra/postgres/migrations/；API JSON 字段用 camelCase，DB 列用 snake_case。
 */
export type TaskStatus = "pending" | "running" | "succeeded" | "failed";

export type ToolCallStatus = "succeeded" | "failed" | "skipped";

/** Planner 单步结束时的结果类型，写入 planner_steps.outcome / GET /tasks plannerTrace[].outcome */
export type PlannerStepOutcome =
  | "direct_answer"
  | "tool_executed"
  | "tool_failed"
  | "budget_exceeded"
  | "duplicate_skipped"
  | "fallback_answer";

export type SessionStatus = "active" | "archived";

export interface SessionRecord {
  id: string;
  title: string | null;
  userId: string | null;
  status: SessionStatus;
  summary: string | null;
  summaryMessageCount: number;
  createdAt: string;
  updatedAt: string;
  lastTaskAt: string | null;
  summaryUpdatedAt: string | null;
}

export interface TaskRecord {
  id: string;
  sessionId?: string | null;
  input: string;
  status: TaskStatus;
  summary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface MessageRecord {
  id: string;
  taskId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
}

export interface ToolCallRecord {
  id: string;
  taskId: string;
  step: number;
  toolName: string;
  toolInput: string;
  toolOutput: string | null;
  status: ToolCallStatus;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface PlannerStepRecord {
  id: string;
  taskId: string;
  step: number;
  needsTool: boolean;
  toolName: string | null;
  toolInput: string | null;
  outcome: PlannerStepOutcome;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number;
  createdAt: string;
  finishedAt: string;
}
