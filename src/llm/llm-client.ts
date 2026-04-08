export interface ToolDefinition {
  name: string;
  description: string;
}

export interface PlannerDecision {
  needsTool: boolean;
  toolName: string | null;
  toolInput: string | null;
  finalAnswer: string;
}

export interface PlanRequest {
  userInput: string;
  tools: ToolDefinition[];
}

export interface LlmClient {
  plan(input: PlanRequest): Promise<PlannerDecision>;
}
