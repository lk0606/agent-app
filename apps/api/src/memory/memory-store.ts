/**
 * MemoryStore：Agent 运行时与 PostgreSQL 之间的抽象接口。
 * sessions / tasks / messages / tool_calls / planner_steps 五张表的读写都经此接口，
 * 便于以后换存储实现（测试可用 in-memory-store）。
 */
import type {
  PlannerStepOutcome,
  PlannerStepRecord,
  SessionRecord,
  SessionStatus,
  TaskRecord,
  TaskStatus,
  ToolCallRecord,
  ToolCallStatus,
} from "./persistence-model.js";

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
  summary?: string | null;
  summaryMessageCount?: number;
  summaryUpdatedAt?: string | null;
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

export interface RecordPlannerStepInput {
  /** 对应 planner_steps 表一行；由 PlannerAgent 在每轮 plan 结束时写入 */
  taskId: string;
  step: number;
  needsTool: boolean;
  toolName?: string | null;
  toolInput?: string | null;
  outcome: PlannerStepOutcome;
  errorCode?: string | null;
  errorMessage?: string | null;
  durationMs: number;
  createdAt: string;
  finishedAt: string;
}

export interface MemoryStore {
  createSession(input: CreateSessionInput): Promise<void>;
  updateSession(sessionId: string, input: UpdateSessionInput): Promise<void>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  listSessions(input?: { status?: SessionStatus; limit?: number }): Promise<SessionRecord[]>;
  createTask(input: CreateTaskInput): Promise<void>;
  updateTask(taskId: string, input: UpdateTaskInput): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | null>;
  listSessionTasks(sessionId: string): Promise<TaskRecord[]>;
  append(taskId: string, message: MemoryMessage): Promise<void>;
  list(taskId: string): Promise<MemoryMessage[]>;
  listAllSessionMessages(sessionId: string): Promise<SessionMemoryMessage[]>;
  listSessionMessages(sessionId: string, limit: number): Promise<SessionMemoryMessage[]>;
  recordToolCall(input: RecordToolCallInput): Promise<void>;
  listTaskToolCalls(taskId: string): Promise<ToolCallRecord[]>;
  recordPlannerStep(input: RecordPlannerStepInput): Promise<void>;
  listTaskPlannerSteps(taskId: string): Promise<PlannerStepRecord[]>;
}
