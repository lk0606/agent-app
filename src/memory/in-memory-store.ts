import type { TaskRecord, ToolCallRecord } from "./persistence-model.ts";
import type { MemoryMessage, MemoryStore } from "./memory-store.ts";

export class InMemoryStore implements MemoryStore {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly store = new Map<string, MemoryMessage[]>();
  private readonly toolCalls = new Map<string, ToolCallRecord[]>();

  async createTask(input: { id: string; input: string; status: TaskRecord["status"] }): Promise<void> {
    const now = new Date().toISOString();
    this.tasks.set(input.id, {
      id: input.id,
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

  async append(taskId: string, message: MemoryMessage): Promise<void> {
    const messages = this.store.get(taskId) ?? [];
    messages.push(message);
    this.store.set(taskId, messages);
  }

  async list(taskId: string): Promise<MemoryMessage[]> {
    return this.store.get(taskId) ?? [];
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
}
