import type { Pool } from "pg";

import type {
  PlannerStepRecord,
  SessionRecord,
  SessionStatus,
  TaskRecord,
  ToolCallRecord,
} from "./persistence-model.js";
import type {
  CreateSessionInput,
  CreateTaskInput,
  MemoryMessage,
  MemoryStore,
  RecordPlannerStepInput,
  RecordToolCallInput,
  SessionMemoryMessage,
  UpdateSessionInput,
  UpdateTaskInput,
} from "./memory-store.js";

type DbTimestamp = {
  toISOString(): string;
};

type SessionRow = {
  id: string;
  title: string | null;
  user_id: string | null;
  status: SessionRecord["status"];
  summary: string | null;
  summary_message_count: number;
  created_at: DbTimestamp;
  updated_at: DbTimestamp;
  last_task_at: DbTimestamp | null;
  summary_updated_at: DbTimestamp | null;
};

type TaskRow = {
  id: string;
  session_id: string | null;
  input: string;
  status: TaskRecord["status"];
  summary: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: DbTimestamp;
  updated_at: DbTimestamp;
  finished_at: DbTimestamp | null;
};

type ToolCallRow = {
  id: string;
  task_id: string;
  step: number;
  tool_name: string;
  tool_input: string;
  tool_output: string | null;
  status: ToolCallRecord["status"];
  error_code: string | null;
  error_message: string | null;
  created_at: DbTimestamp;
  finished_at: DbTimestamp | null;
};

type PlannerStepRow = {
  id: string;
  task_id: string;
  step: number;
  needs_tool: boolean;
  tool_name: string | null;
  tool_input: string | null;
  outcome: PlannerStepRecord["outcome"];
  error_code: string | null;
  error_message: string | null;
  duration_ms: number;
  created_at: DbTimestamp;
  finished_at: DbTimestamp;
};

export class PostgresMemoryStore implements MemoryStore {
  constructor(private readonly pool: Pool) {}

  // 创建会话时允许重复调用，HTTP 层复用 sessionId 时不会因为并发重复创建而失败。
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

  // 只更新传入字段；未传字段继续保留数据库里的旧值。
  async updateSession(sessionId: string, input: UpdateSessionInput): Promise<void> {
    await this.pool.query(
      `
        update sessions
        set
          -- coalesce 让调用方可以只传要改的字段；传 null/undefined 时保持原值。
          title = coalesce($2, title),
          status = coalesce($3, status),
          updated_at = now(),
          last_task_at = coalesce($4, last_task_at),
          summary = coalesce($5, summary),
          summary_message_count = coalesce($6, summary_message_count),
          summary_updated_at = coalesce($7, summary_updated_at)
        where id = $1
      `,
      [
        sessionId,
        input.title ?? null,
        input.status ?? null,
        input.lastTaskAt ?? null,
        input.summary ?? null,
        input.summaryMessageCount ?? null,
        input.summaryUpdatedAt ?? null,
      ],
    );
  }

  // 读取 session 元数据，包括持久化摘要状态，供 Planner 判断是否需要增量总结。
  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const result = await this.pool.query<SessionRow>(
      `
        select
          id,
          title,
          user_id,
          status,
          summary,
          summary_message_count,
          created_at,
          updated_at,
          last_task_at,
          summary_updated_at
        from sessions
        where id = $1
      `,
      [sessionId],
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return this.toSessionRecord(row);
  }

  async listSessions(input: { status?: SessionStatus; limit?: number } = {}): Promise<SessionRecord[]> {
    const result = await this.pool.query<SessionRow>(
      `
        select
          id,
          title,
          user_id,
          status,
          summary,
          summary_message_count,
          created_at,
          updated_at,
          last_task_at,
          summary_updated_at
        from sessions
        where ($1::text is null or status = $1)
        order by coalesce(last_task_at, created_at) desc, created_at desc
        limit $2
      `,
      [input.status ?? null, input.limit ?? 50],
    );

    return result.rows.map((row) => this.toSessionRecord(row));
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
    const result = await this.pool.query<TaskRow>(
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

    return this.toTaskRecord(row);
  }

  async listSessionTasks(sessionId: string): Promise<TaskRecord[]> {
    const result = await this.pool.query<TaskRow>(
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
        where session_id = $1
        order by created_at asc, id asc
      `,
      [sessionId],
    );

    return result.rows.map((row) => this.toTaskRecord(row));
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

  // 拉取某个 session 的完整消息时间线，用于构造“摘要 + 最近窗口”的上下文。
  async listAllSessionMessages(sessionId: string): Promise<SessionMemoryMessage[]> {
    const result = await this.pool.query(
      `
        select
          m.task_id,
          m.role,
          m.content,
          m.created_at
        from messages m
        inner join tasks t on t.id = m.task_id
        where t.session_id = $1
        order by m.created_at asc, m.id asc
      `,
      [sessionId],
    );

    return result.rows.map((row) => ({
      taskId: row.task_id,
      role: row.role,
      content: row.content,
      timestamp: row.created_at.toISOString(),
    }));
  }

  async listSessionMessages(sessionId: string, limit: number): Promise<SessionMemoryMessage[]> {
    const rows = await this.listAllSessionMessages(sessionId);
    return rows.slice(-limit);
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

  async listTaskToolCalls(taskId: string): Promise<ToolCallRecord[]> {
    const result = await this.pool.query<ToolCallRow>(
      `
        select
          id,
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
        from tool_calls
        where task_id = $1
        order by step asc, id asc
      `,
      [taskId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      step: row.step,
      toolName: row.tool_name,
      toolInput: row.tool_input,
      toolOutput: row.tool_output,
      status: row.status,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      createdAt: row.created_at.toISOString(),
      finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    }));
  }

  async recordPlannerStep(input: RecordPlannerStepInput): Promise<void> {
    // planner_steps：Planner 每轮 llm.plan 的决策快照，供 plannerTrace API / replay 还原「为何选这个工具」。
    await this.pool.query(
      `
        insert into planner_steps (
          task_id,
          step,
          needs_tool,
          tool_name,
          tool_input,
          outcome,
          error_code,
          error_message,
          duration_ms,
          created_at,
          finished_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        input.taskId,
        input.step,
        input.needsTool,
        input.toolName ?? null,
        input.toolInput ?? null,
        input.outcome,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.durationMs,
        input.createdAt,
        input.finishedAt,
      ],
    );
  }

  async listTaskPlannerSteps(taskId: string): Promise<PlannerStepRecord[]> {
    const result = await this.pool.query<PlannerStepRow>(
      `
        select
          id,
          task_id,
          step,
          needs_tool,
          tool_name,
          tool_input,
          outcome,
          error_code,
          error_message,
          duration_ms,
          created_at,
          finished_at
        from planner_steps
        where task_id = $1
        order by step asc, id asc
      `,
      [taskId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      step: row.step,
      needsTool: row.needs_tool,
      toolName: row.tool_name,
      toolInput: row.tool_input,
      outcome: row.outcome,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      durationMs: row.duration_ms,
      createdAt: row.created_at.toISOString(),
      finishedAt: row.finished_at.toISOString(),
    }));
  }

  private toSessionRecord(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      title: row.title,
      userId: row.user_id,
      status: row.status,
      summary: row.summary,
      summaryMessageCount: row.summary_message_count,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      lastTaskAt: row.last_task_at ? row.last_task_at.toISOString() : null,
      summaryUpdatedAt: row.summary_updated_at ? row.summary_updated_at.toISOString() : null,
    };
  }

  private toTaskRecord(row: TaskRow): TaskRecord {
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
}
