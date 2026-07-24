/**
 * 前后端共享 API 契约（Zod schema + 推导类型）。
 * 后端 parseSchema 校验入参；前端 fetch 后 .parse() 校验出参。改字段先改这里。
 */
import { z } from "zod";

/** cancelled：用户取消或任务超时中止（E.8），与 failed（工具/LLM 业务失败）区分 */
export const TaskStatusSchema = z.enum(["pending", "running", "succeeded", "failed", "cancelled"]);

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

export const GetTaskResponseSchema = z.object({
  task: TaskRecordSchema,
  messages: z.array(MemoryMessageSchema),
  toolCalls: z.array(ToolCallRecordSchema),
  /** Planner 决策链（非 OpenTelemetry traceId）；命名见 docs/current-status.md 【H 节】 */
  plannerTrace: z.array(PlannerStepRecordSchema),
});

/** POST /tasks/:taskId/cancel（E.8）：请求取消运行中任务 */
export const CancelTaskResponseSchema = z.object({
  taskId: z.string(),
  /** true = 已向运行中任务发出 abort；false = 当时没有可取消的运行态 */
  cancelled: z.boolean(),
  /** 发出请求时的任务状态（最终 cancelled 需再 GET /tasks/:id） */
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
