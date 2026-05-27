import { z } from "zod";

export const TaskStatusSchema = z.enum(["pending", "running", "succeeded", "failed"]);

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

export const RunAgentRequestSchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
  taskId: z.string().trim().min(1).optional(),
  input: z.string().trim().min(1, "input must be a non-empty string"),
});

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
});

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  time: IsoDateTimeSchema,
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
