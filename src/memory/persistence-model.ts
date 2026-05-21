export type TaskStatus = "pending" | "running" | "succeeded" | "failed";

export type ToolCallStatus = "succeeded" | "failed" | "skipped";

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
