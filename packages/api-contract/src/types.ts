import type { z } from "zod";

import type {
  AgentResultSchema,
  AgentToolCallSchema,
  ArchiveSessionResponseSchema,
  ErrorResponseSchema,
  GetSessionMessagesResponseSchema,
  GetSessionResponseSchema,
  GetTaskResponseSchema,
  HealthResponseSchema,
  ListSessionsQuerySchema,
  ListSessionsResponseSchema,
  MemoryMessageSchema,
  PlannerStepRecordSchema,
  RunAgentRequestSchema,
  RunAgentResponseSchema,
  SessionMemoryMessageSchema,
  SessionRecordSchema,
  TaskRecordSchema,
  ToolCallRecordSchema,
} from "./schemas.js";

export type SessionRecord = z.infer<typeof SessionRecordSchema>;
export type TaskRecord = z.infer<typeof TaskRecordSchema>;
export type MemoryMessage = z.infer<typeof MemoryMessageSchema>;
export type SessionMemoryMessage = z.infer<typeof SessionMemoryMessageSchema>;
export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;
export type PlannerStepRecord = z.infer<typeof PlannerStepRecordSchema>;

export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;
export type AgentResult = z.infer<typeof AgentResultSchema>;

export type RunAgentRequest = z.infer<typeof RunAgentRequestSchema>;
export type RunAgentResponse = z.infer<typeof RunAgentResponseSchema>;
export type ListSessionsQuery = z.infer<typeof ListSessionsQuerySchema>;
export type ListSessionsResponse = z.infer<typeof ListSessionsResponseSchema>;
export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>;
export type GetSessionMessagesResponse = z.infer<typeof GetSessionMessagesResponseSchema>;
export type ArchiveSessionResponse = z.infer<typeof ArchiveSessionResponseSchema>;
export type GetTaskResponse = z.infer<typeof GetTaskResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
