import type { AgentStreamEvent } from "@agent-app/api-contract";
import type { LlmClient } from "../llm/llm-client.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { Logger } from "../shared/logger.js";
import type { Tool } from "../tools/tool.js";

export interface AgentContext {
  tools: Tool[];
  memory: MemoryStore;
  llm: LlmClient;
  logger: Logger;
  /** 可选：POST /agent/stream 注入，用于推送 SSE 事件 */
  emitStream?: (event: AgentStreamEvent) => void;
}

export interface AgentRequest {
  taskId: string;
  sessionId?: string | null;
  input: string;
}

export interface AgentResponse {
  summary: string;
  toolCalls: Array<{
    toolName: string;
    input: string;
    output: string;
  }>;
}

export interface Agent {
  plan(request: AgentRequest, context: AgentContext): Promise<AgentResponse>;
}
