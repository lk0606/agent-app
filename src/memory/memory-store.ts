import type { TaskRecord, TaskStatus, ToolCallStatus } from "./persistence-model.js";

export interface MemoryMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
}

export interface CreateTaskInput {
  id: string;
  input: string;
  status: TaskStatus;
}

export interface UpdateTaskInput {
  status: TaskStatus;
  summary?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  finishedAt?: string | null;
}

export interface RecordToolCallInput {
  taskId: string;
  step: number;
  toolName: string;
  toolInput: string;
  toolOutput?: string | null;
  status: ToolCallStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  finishedAt?: string | null;
}

export interface MemoryStore {
  createTask(input: CreateTaskInput): Promise<void>;
  updateTask(taskId: string, input: UpdateTaskInput): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | null>;
  append(taskId: string, message: MemoryMessage): Promise<void>;
  list(taskId: string): Promise<MemoryMessage[]>;
  recordToolCall(input: RecordToolCallInput): Promise<void>;
}
