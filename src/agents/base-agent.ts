import type { LlmClient } from "../llm/llm-client.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { Tool } from "../tools/tool.js";

export interface AgentContext {
  tools: Tool[];
  memory: MemoryStore;
  llm: LlmClient;
}

export interface AgentRequest {
  taskId: string;
  input: string;
}

export interface AgentResponse {
  summary: string;
  toolCalls: Array<{
    toolName: string;
    output: string;
  }>;
}

export interface Agent {
  plan(request: AgentRequest, context: AgentContext): Promise<AgentResponse>;
}
