import type { SessionRecord, SessionStatus, TaskRecord, TaskStatus, ToolCallStatus } from "./persistence-model.js";

export interface MemoryMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
}

export interface SessionMemoryMessage extends MemoryMessage {
  taskId: string;
}

export interface CreateTaskInput {
  id: string;
  sessionId?: string | null;
  input: string;
  status: TaskStatus;
}

export interface CreateSessionInput {
  id: string;
  title?: string | null;
  userId?: string | null;
  status?: SessionStatus;
}

export interface UpdateSessionInput {
  title?: string | null;
  status?: SessionStatus;
  lastTaskAt?: string | null;
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
  createSession(input: CreateSessionInput): Promise<void>;
  updateSession(sessionId: string, input: UpdateSessionInput): Promise<void>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  createTask(input: CreateTaskInput): Promise<void>;
  updateTask(taskId: string, input: UpdateTaskInput): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | null>;
  append(taskId: string, message: MemoryMessage): Promise<void>;
  list(taskId: string): Promise<MemoryMessage[]>;
  listAllSessionMessages(sessionId: string): Promise<SessionMemoryMessage[]>;
  listSessionMessages(sessionId: string, limit: number): Promise<SessionMemoryMessage[]>;
  recordToolCall(input: RecordToolCallInput): Promise<void>;
}
