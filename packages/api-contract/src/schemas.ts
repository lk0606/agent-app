/**
 * 前后端共享 API 契约（Zod schema + 推导类型）。
 * 后端 parseSchema 校验入参；前端 fetch 后 .parse() 校验出参。改字段先改这里。
 */
import { z } from "zod";

/**
 * cancelled：用户取消或任务超时中止（E.8）
 * awaiting_confirmation：危险工具执行前等人批准（E.10），与 running 区分
 * failed：工具/LLM 业务失败
 */
export const TaskStatusSchema = z.enum([
  "pending",
  "running",
  "awaiting_confirmation",
  "succeeded",
  "failed",
  "cancelled",
]);

export const ToolCallStatusSchema = z.enum(["succeeded", "failed", "skipped"]);

export const SessionStatusSchema = z.enum(["active", "archived"]);

export const MessageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);

const IsoDateTimeSchema = z.string().min(1);

export const SessionRecordSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  userId: z.string().nullable(),
  status: SessionStatusSchema,
  summary: z.string().nullable(),
  summaryMessageCount: z.number().int().nonnegative(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  lastTaskAt: IsoDateTimeSchema.nullable(),
  summaryUpdatedAt: IsoDateTimeSchema.nullable(),
});

export const TaskRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string().nullable().optional(),
  input: z.string(),
  status: TaskStatusSchema,
  summary: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.nullable(),
});

export const MemoryMessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
  timestamp: IsoDateTimeSchema,
});

export const SessionMemoryMessageSchema = MemoryMessageSchema.extend({
  taskId: z.string(),
});

export const PlannerStepOutcomeSchema = z.enum([
  "direct_answer",
  "tool_executed",
  "tool_failed",
  "budget_exceeded",
  "duplicate_skipped",
  "fallback_answer",
  /** E.10：人工拒绝执行需确认的工具（工具未真正跑；任务仍可 succeeded） */
  "human_rejected",
  /**
   * E.12：Supervisor 路由一步（非真实工具）。
   * toolName 为专家 id：docs | files | general；随后由该专家的 Planner 继续写后续 step。
   */
  "routed",
  /**
   * E.12.x：受限专家请求升级到 general（非真实工具）。
   * 紧随其后的 routed/general 才表示 Supervisor 已接受这次升级。
   */
  "escalated",
]);

export const PlannerStepRecordSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  step: z.number().int().positive(),
  needsTool: z.boolean(),
  toolName: z.string().nullable(),
  toolInput: z.string().nullable(),
  outcome: PlannerStepOutcomeSchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  createdAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema,
});

export const ToolCallRecordSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  step: z.number().int().positive(),
  toolName: z.string(),
  toolInput: z.string(),
  toolOutput: z.string().nullable(),
  status: ToolCallStatusSchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.nullable(),
});

export const AgentToolCallSchema = z.object({
  toolName: z.string(),
  input: z.string(),
  output: z.string(),
});

export const AgentResultSchema = z.object({
  summary: z.string(),
  toolCalls: z.array(AgentToolCallSchema),
});

// strict：拒绝未知字段（如 input1），便于 400 的 details 准确提示拼写错误
export const RunAgentRequestSchema = z
  .object({
    sessionId: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    input: z.string().trim().min(1, "input must be a non-empty string"),
  })
  .strict();

export const RunAgentResponseSchema = z.object({
  sessionId: z.string(),
  taskId: z.string(),
  result: AgentResultSchema,
});

export const ListSessionsQuerySchema = z.object({
  status: SessionStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export const ListSessionsResponseSchema = z.object({
  sessions: z.array(SessionRecordSchema),
});

export const GetSessionResponseSchema = z.object({
  session: SessionRecordSchema,
  tasks: z.array(TaskRecordSchema),
});

export const GetSessionMessagesResponseSchema = z.object({
  sessionId: z.string(),
  messages: z.array(SessionMemoryMessageSchema),
});

export const ArchiveSessionResponseSchema = z.object({
  session: SessionRecordSchema.nullable(),
});

/** E.9：单次 LLM HTTP 调用明细（写入 task_metrics.llm_calls） */
export const LlmCallMetricsSchema = z.object({
  purpose: z.enum(["plan", "answer", "summarize", "route"]),
  model: z.string(),
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative(),
});

/** E.9：任务聚合观测；关联键是 taskId，不是 traceId */
export const TaskMetricsSchema = z.object({
  taskId: z.string(),
  durationMs: z.number().int().nonnegative(),
  llmCallCount: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  plannerStepCount: z.number().int().nonnegative(),
  /** 学习用估算 USD；无 usage 时为 null */
  estimatedCostUsd: z.number().nonnegative().nullable(),
  llmCalls: z.array(LlmCallMetricsSchema),
});

/** E.10：当前挂起等待人工确认的工具信息（进程内；无 waiter 时为 null） */
export const PendingConfirmationSchema = z.object({
  step: z.number().int().positive(),
  toolName: z.string(),
  toolInput: z.string(),
});

export const GetTaskResponseSchema = z.object({
  task: TaskRecordSchema,
  messages: z.array(MemoryMessageSchema),
  toolCalls: z.array(ToolCallRecordSchema),
  /** Planner 决策链（非 OpenTelemetry traceId）；命名见 docs/current-status.md 【H 节】 */
  plannerTrace: z.array(PlannerStepRecordSchema),
  /**
   * E.9：任务级成本/耗时聚合（表 task_metrics）。
   * 与 plannerTrace（决策）/ toolCalls（工具执行）/ 未来 traceId（分布式链路）分开。
   * 旧任务或仍在 running 时可能为 null。
   */
  metrics: TaskMetricsSchema.nullable(),
  /**
   * E.10：status=awaiting_confirmation 且本进程仍有 waiter 时非 null。
   * 进程重启后孤儿任务可能 status 仍为 awaiting_confirmation 但本字段为 null。
   */
  pendingConfirmation: PendingConfirmationSchema.nullable(),
});

/** POST /tasks/:taskId/cancel（E.8）：请求取消运行中 / 待确认任务 */
export const CancelTaskResponseSchema = z.object({
  taskId: z.string(),
  /** true = 已向运行中任务发出 abort，或已把孤儿 awaiting 标为 cancelled */
  cancelled: z.boolean(),
  /** 发出请求时的任务状态（最终 cancelled 需再 GET /tasks/:id） */
  status: TaskStatusSchema,
});

/**
 * POST /tasks/:taskId/confirm（E.10）
 * 例：`{"decision":"approve"}` → 唤醒 write_file 门控；`reject` → 不写盘
 */
export const ConfirmTaskRequestSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
  })
  .strict();

export const ConfirmTaskResponseSchema = z.object({
  taskId: z.string(),
  /** false：status 不是 awaiting，或（不应出现）resolve 失败走了另一分支 */
  accepted: z.boolean(),
  /** accepted=false 时为 null；否则回显请求里的 approve/reject */
  decision: z.enum(["approve", "reject"]).nullable(),
  /** 发请求时读到的状态；批准后会变 running，须再 GET 看终态 */
  status: TaskStatusSchema,
});

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  time: IsoDateTimeSchema,
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    // Zod / 业务校验失败时的字段级说明，如 "input: expected string, received number"
    details: z.array(z.string()).optional(),
  }),
});
