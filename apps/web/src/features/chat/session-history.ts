import type { SessionMemoryMessage, TaskRecord } from "@agent-app/api-contract";

import type { AssistantRunMessage, ChatItem } from "./run-types";

/** 将服务端 session 消息 + 任务列表还原为工作台 ChatItem（历史无 RunTimeline 步骤） */
export function sessionMessagesToChatItems(
  messages: SessionMemoryMessage[],
  tasks: TaskRecord[],
): ChatItem[] {
  const sortedTasks = [...tasks].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );

  const items: ChatItem[] = [];

  for (const task of sortedTasks) {
    const taskMessages = messages.filter((message) => message.taskId === task.id);
    const userMessage = taskMessages.find((message) => message.role === "user");
    const assistantMessage = taskMessages.find((message) => message.role === "assistant");
    const userMessageId = `${task.id}-user`;

    if (userMessage) {
      items.push({
        id: userMessageId,
        role: "user",
        content: userMessage.content,
        status: "sent",
      });
    }

    const answer = assistantMessage?.content ?? task.summary ?? "";

    // 失败任务可能没有 assistant 消息，仍要展示 error 气泡
    if (answer || task.status === "failed") {
      items.push(createHistoricalAssistantRun({
        task,
        userMessageId,
        answer,
      }));
    }
  }

  return items;
}

function createHistoricalAssistantRun(input: {
  task: TaskRecord;
  userMessageId: string;
  answer: string;
}): AssistantRunMessage {
  const { task, userMessageId, answer } = input;

  // 历史只还原 answer 步骤；规划/工具细节在调试面板的 plannerTrace / toolCalls
  return {
    id: task.id,
    role: "assistant-run",
    replyToMessageId: userMessageId,
    taskId: task.id,
    status: task.status === "failed" ? "failed" : "done",
    steps: answer
      ? [
          {
            id: "answer",
            kind: "answer",
            content: answer,
            streaming: false,
          },
        ]
      : [],
    error: task.errorMessage ?? undefined,
  };
}

export function formatSessionPreview(input: string | null | undefined, fallback: string): string {
  const trimmed = input?.trim();

  if (!trimmed) {
    return fallback;
  }

  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
}
