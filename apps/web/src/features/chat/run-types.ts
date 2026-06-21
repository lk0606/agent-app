export type ToolStepStatus = "running" | "succeeded" | "failed";

export type RunStep =
  | {
      id: string;
      kind: "planner_decision";
      step: number;
      needsTool: boolean;
      toolName: string | null;
      toolInput: string | null;
    }
  | {
      id: string;
      kind: "tool";
      step: number;
      toolName: string;
      toolInput: string;
      status: ToolStepStatus;
      output?: string | null;
      errorMessage?: string | null;
    }
  | {
      id: string;
      kind: "answer";
      content: string;
      streaming: boolean;
    };

export type AssistantRunStatus = "running" | "done" | "failed";

export interface AssistantRunMessage {
  id: string;
  role: "assistant-run";
  replyToMessageId: string;
  taskId?: string;
  status: AssistantRunStatus;
  steps: RunStep[];
  error?: string;
}

export type UserChatMessage = {
  id: string;
  role: "user";
  content: string;
  status?: "sending" | "sent" | "failed";
  error?: string;
};

export type ChatItem = UserChatMessage | AssistantRunMessage;

export function isAssistantRun(message: ChatItem): message is AssistantRunMessage {
  return message.role === "assistant-run";
}

export function createAssistantRun(id: string, replyToMessageId: string): AssistantRunMessage {
  return {
    id,
    role: "assistant-run",
    replyToMessageId,
    status: "running",
    steps: [],
  };
}
