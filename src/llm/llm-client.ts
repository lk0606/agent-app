export interface ToolDefinition {
  name: string;
  description: string;
}

export interface PlannerDecision {
  needsTool: boolean;
  toolName: string | null;
  toolInput: string | null;
  draftAnswer: string;
}

export interface PlanRequest {
  sessionSummary?: string | null;
  conversationHistory: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
  }>;
  userInput: string;
  tools: ToolDefinition[];
  previousToolCalls: Array<{
    toolName: string;
    toolInput: string;
    toolOutput: string;
  }>;
}

export interface AnswerRequest {
  sessionSummary?: string | null;
  conversationHistory: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
  }>;
  userInput: string;
  toolName: string;
  toolInput: string;
  toolOutput: string;
}

export interface SessionSummaryRequest {
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
  }>;
  currentUserInput: string;
}

export interface LlmClient {
  plan(input: PlanRequest): Promise<PlannerDecision>;
  answerWithTool(input: AnswerRequest): Promise<string>;
  summarizeSession(input: SessionSummaryRequest): Promise<string>;
}
