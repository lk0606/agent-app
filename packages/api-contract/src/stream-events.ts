import { z } from "zod";

import { AgentResultSchema } from "./schemas.js";

/** SSE 事件名（POST /agent/stream）；与 OpenTelemetry traceId 无关，见 docs/current-status.md 【H 节】 */
export const AgentStreamEventTypeSchema = z.enum([
  "thinking",
  "tool_start",
  "tool_end",
  "token",
  "done",
  "error",
]);

const StreamTaskRefSchema = z.object({
  taskId: z.string(),
});

export const AgentStreamThinkingEventSchema = StreamTaskRefSchema.extend({
  type: z.literal("thinking"),
  step: z.number().int().positive(),
});

export const AgentStreamToolStartEventSchema = StreamTaskRefSchema.extend({
  type: z.literal("tool_start"),
  step: z.number().int().positive(),
  toolName: z.string(),
  toolInput: z.string(),
});

export const AgentStreamToolEndEventSchema = StreamTaskRefSchema.extend({
  type: z.literal("tool_end"),
  step: z.number().int().positive(),
  toolName: z.string(),
  status: z.enum(["succeeded", "failed"]),
  toolOutput: z.string().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
});

export const AgentStreamTokenEventSchema = StreamTaskRefSchema.extend({
  type: z.literal("token"),
  delta: z.string(),
});

export const AgentStreamDoneEventSchema = z.object({
  type: z.literal("done"),
  sessionId: z.string(),
  taskId: z.string(),
  result: AgentResultSchema,
});

export const AgentStreamErrorEventSchema = z.object({
  type: z.literal("error"),
  taskId: z.string().nullable().optional(),
  code: z.string(),
  message: z.string(),
});

export const AgentStreamEventSchema = z.discriminatedUnion("type", [
  AgentStreamThinkingEventSchema,
  AgentStreamToolStartEventSchema,
  AgentStreamToolEndEventSchema,
  AgentStreamTokenEventSchema,
  AgentStreamDoneEventSchema,
  AgentStreamErrorEventSchema,
]);
