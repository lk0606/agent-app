import type { Pool } from "pg";

import type { SessionRecord, TaskRecord } from "./persistence-model.js";
import type {
  CreateSessionInput,
  CreateTaskInput,
  MemoryMessage,
  MemoryStore,
  RecordToolCallInput,
  SessionMemoryMessage,
  UpdateSessionInput,
  UpdateTaskInput,
} from "./memory-store.js";

export class PostgresMemoryStore implements MemoryStore {
  constructor(private readonly pool: Pool) {}

  async createSession(input: CreateSessionInput): Promise<void> {
    await this.pool.query(
      `
        insert into sessions (id, title, user_id, status)
        values ($1, $2, $3, $4)
        on conflict (id) do nothing
      `,
      [input.id, input.title ?? null, input.userId ?? null, input.status ?? "active"],
    );
  }

  async updateSession(sessionId: string, input: UpdateSessionInput): Promise<void> {
    await this.pool.query(
      `
        update sessions
        set
          title = coalesce($2, title),
          status = coalesce($3, status),
          updated_at = now(),
          last_task_at = coalesce($4, last_task_at)
        where id = $1
      `,
      [sessionId, input.title ?? null, input.status ?? null, input.lastTaskAt ?? null],
    );
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const result = await this.pool.query(
      `
        select id, title, user_id, status, created_at, updated_at, last_task_at
        from sessions
        where id = $1
      `,
      [sessionId],
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      userId: row.user_id,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      lastTaskAt: row.last_task_at ? row.last_task_at.toISOString() : null,
    };
  }

  async createTask(input: CreateTaskInput): Promise<void> {
    await this.pool.query(
      `
        insert into tasks (id, session_id, input, status)
        values ($1, $2, $3, $4)
        on conflict (id) do nothing
      `,
      [input.id, input.sessionId ?? null, input.input, input.status],
    );
  }

  async updateTask(taskId: string, input: UpdateTaskInput): Promise<void> {
    await this.pool.query(
      `
        update tasks
        set
          status = $2,
          summary = coalesce($3, summary),
          error_code = coalesce($4, error_code),
          error_message = coalesce($5, error_message),
          updated_at = now(),
          finished_at = coalesce($6, finished_at)
        where id = $1
      `,
      [taskId, input.status, input.summary ?? null, input.errorCode ?? null, input.errorMessage ?? null, input.finishedAt ?? null],
    );
  }

  async getTask(taskId: string): Promise<TaskRecord | null> {
    const result = await this.pool.query(
      `
        select
          id,
          session_id,
          input,
          status,
          summary,
          error_code,
          error_message,
          created_at,
          updated_at,
          finished_at
        from tasks
        where id = $1
      `,
      [taskId],
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      sessionId: row.session_id,
      input: row.input,
      status: row.status,
      summary: row.summary,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    };
  }

  async append(taskId: string, message: MemoryMessage): Promise<void> {
    await this.pool.query(
      `
        insert into messages (task_id, role, content, created_at)
        values ($1, $2, $3, $4)
      `,
      [taskId, message.role, message.content, message.timestamp],
    );
  }

  async list(taskId: string): Promise<MemoryMessage[]> {
    const result = await this.pool.query(
      `
        select role, content, created_at
        from messages
        where task_id = $1
        order by created_at asc, id asc
      `,
      [taskId],
    );

    return result.rows.map((row) => ({
      role: row.role,
      content: row.content,
      timestamp: row.created_at.toISOString(),
    }));
  }

  async listSessionMessages(sessionId: string, limit: number): Promise<SessionMemoryMessage[]> {
    const result = await this.pool.query(
      `
        select *
        from (
          select
            m.task_id,
            m.role,
            m.content,
            m.created_at
          from messages m
          inner join tasks t on t.id = m.task_id
          where t.session_id = $1
          order by m.created_at desc, m.id desc
          limit $2
        ) recent
        order by created_at asc
      `,
      [sessionId, limit],
    );

    return result.rows.map((row) => ({
      taskId: row.task_id,
      role: row.role,
      content: row.content,
      timestamp: row.created_at.toISOString(),
    }));
  }

  async recordToolCall(input: RecordToolCallInput): Promise<void> {
    await this.pool.query(
      `
        insert into tool_calls (
          task_id,
          step,
          tool_name,
          tool_input,
          tool_output,
          status,
          error_code,
          error_message,
          created_at,
          finished_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        input.taskId,
        input.step,
        input.toolName,
        input.toolInput,
        input.toolOutput ?? null,
        input.status,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.createdAt,
        input.finishedAt ?? null,
      ],
    );
  }
}
