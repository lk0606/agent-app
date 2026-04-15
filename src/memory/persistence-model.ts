export type TaskStatus = "pending" | "running" | "succeeded" | "failed";

export type ToolCallStatus = "succeeded" | "failed" | "skipped";

export interface TaskRecord {
  id: string;
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
