import type { PlannerStepRecord, SessionRecord, TaskRecord, ToolCallRecord } from "./persistence-model.js";
import type {
  MemoryMessage,
  MemoryStore,
  RecordPlannerStepInput,
  SessionMemoryMessage,
} from "./memory-store.js";

export class InMemoryStore implements MemoryStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly store = new Map<string, MemoryMessage[]>();
  private readonly toolCalls = new Map<string, ToolCallRecord[]>();
  private readonly plannerSteps = new Map<string, PlannerStepRecord[]>();

  async createSession(input: {
    id: string;
    title?: string | null;
    userId?: string | null;
    status?: SessionRecord["status"];
  }): Promise<void> {
    const now = new Date().toISOString();
    this.sessions.set(input.id, {
      id: input.id,
      title: input.title ?? null,
      userId: input.userId ?? null,
      status: input.status ?? "active",
      summary: null,
      summaryMessageCount: 0,
      createdAt: now,
      updatedAt: now,
      lastTaskAt: null,
      summaryUpdatedAt: null,
    });
  }

  async updateSession(
    sessionId: string,
    input: {
      title?: string | null;
      status?: SessionRecord["status"];
      lastTaskAt?: string | null;
      summary?: string | null;
      summaryMessageCount?: number;
      summaryUpdatedAt?: string | null;
    },
  ): Promise<void> {
    const current = this.sessions.get(sessionId);

    if (!current) {
      return;
    }

    this.sessions.set(sessionId, {
      ...current,
      title: input.title ?? current.title,
      status: input.status ?? current.status,
      lastTaskAt: input.lastTaskAt ?? current.lastTaskAt,
      summary: input.summary ?? current.summary,
      summaryMessageCount: input.summaryMessageCount ?? current.summaryMessageCount,
      summaryUpdatedAt: input.summaryUpdatedAt ?? current.summaryUpdatedAt,
      updatedAt: new Date().toISOString(),
    });
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async listSessions(input: { status?: SessionRecord["status"]; limit?: number } = {}): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
      .filter((session) => (input.status ? session.status === input.status : true))
      .sort((left, right) => {
        const leftTime = left.lastTaskAt ?? left.createdAt;
        const rightTime = right.lastTaskAt ?? right.createdAt;
        return rightTime.localeCompare(leftTime);
      })
      .slice(0, input.limit ?? 50);
  }

  async createTask(input: {
    id: string;
    sessionId?: string | null;
    input: string;
    status: TaskRecord["status"];
  }): Promise<void> {
    const now = new Date().toISOString();
    this.tasks.set(input.id, {
      id: input.id,
      sessionId: input.sessionId ?? null,
      input: input.input,
      status: input.status,
      summary: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    });
  }

  async updateTask(
    taskId: string,
    input: {
      status: TaskRecord["status"];
      summary?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      finishedAt?: string | null;
    },
  ): Promise<void> {
    const current = this.tasks.get(taskId);

    if (!current) {
      return;
    }

    this.tasks.set(taskId, {
      ...current,
      status: input.status,
      summary: input.summary ?? current.summary,
      errorCode: input.errorCode ?? current.errorCode,
      errorMessage: input.errorMessage ?? current.errorMessage,
      updatedAt: new Date().toISOString(),
      finishedAt: input.finishedAt ?? current.finishedAt,
    });
  }

  async getTask(taskId: string): Promise<TaskRecord | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async listSessionTasks(sessionId: string): Promise<TaskRecord[]> {
    return [...this.tasks.values()]
      .filter((task) => task.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async append(taskId: string, message: MemoryMessage): Promise<void> {
    const messages = this.store.get(taskId) ?? [];
    messages.push(message);
    this.store.set(taskId, messages);
  }

  async list(taskId: string): Promise<MemoryMessage[]> {
    return this.store.get(taskId) ?? [];
  }

  async listAllSessionMessages(sessionId: string): Promise<SessionMemoryMessage[]> {
    const rows: SessionMemoryMessage[] = [];

    for (const [taskId, task] of this.tasks.entries()) {
      if (task.sessionId !== sessionId) {
        continue;
      }

      for (const message of this.store.get(taskId) ?? []) {
        rows.push({
          taskId,
          ...message,
        });
      }
    }

    return rows.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }

  async listSessionMessages(sessionId: string, limit: number): Promise<SessionMemoryMessage[]> {
    const rows = await this.listAllSessionMessages(sessionId);
    return rows.slice(-limit);
  }

  async recordToolCall(input: {
    taskId: string;
    step: number;
    toolName: string;
    toolInput: string;
    toolOutput?: string | null;
    status: ToolCallRecord["status"];
    errorCode?: string | null;
    errorMessage?: string | null;
    createdAt: string;
    finishedAt?: string | null;
  }): Promise<void> {
    const rows = this.toolCalls.get(input.taskId) ?? [];

    rows.push({
      id: `${input.taskId}-${input.step}-${rows.length + 1}`,
      taskId: input.taskId,
      step: input.step,
      toolName: input.toolName,
      toolInput: input.toolInput,
      toolOutput: input.toolOutput ?? null,
      status: input.status,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      createdAt: input.createdAt,
      finishedAt: input.finishedAt ?? null,
    });

    this.toolCalls.set(input.taskId, rows);
  }

  async listTaskToolCalls(taskId: string): Promise<ToolCallRecord[]> {
    return [...(this.toolCalls.get(taskId) ?? [])].sort((left, right) => left.step - right.step);
  }

  async recordPlannerStep(input: RecordPlannerStepInput): Promise<void> {
    const rows = this.plannerSteps.get(input.taskId) ?? [];

    rows.push({
      id: `${input.taskId}-planner-${input.step}-${rows.length + 1}`,
      taskId: input.taskId,
      step: input.step,
      needsTool: input.needsTool,
      toolName: input.toolName ?? null,
      toolInput: input.toolInput ?? null,
      outcome: input.outcome,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      durationMs: input.durationMs,
      createdAt: input.createdAt,
      finishedAt: input.finishedAt,
    });

    this.plannerSteps.set(input.taskId, rows);
  }

  async listTaskPlannerSteps(taskId: string): Promise<PlannerStepRecord[]> {
    return [...(this.plannerSteps.get(taskId) ?? [])].sort((left, right) => left.step - right.step);
  }
}
