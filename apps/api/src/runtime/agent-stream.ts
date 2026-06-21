import type { AgentStreamEvent } from "@agent-app/api-contract";
import type { PlannerDecision } from "../llm/llm-client.js";

export type StreamEmitter = (event: AgentStreamEvent) => void;

/** plan() 完成后立刻推送，让 UI 知道「准备调哪个工具」 */
export function emitPlannerDecision(
  emit: StreamEmitter | undefined,
  taskId: string,
  step: number,
  decision: Pick<PlannerDecision, "needsTool" | "toolName" | "toolInput">,
): void {
  emit?.({
    type: "planner_decision",
    taskId,
    step,
    needsTool: decision.needsTool,
    toolName: decision.toolName,
    toolInput: decision.toolInput,
  });
}

/** 无 LLM stream 时的 fallback（如 plan 直接返回 draftAnswer） */
export async function emitTokenStream(
  emit: StreamEmitter,
  taskId: string,
  text: string,
  chunkSize = 4,
): Promise<void> {
  if (text.length === 0) {
    return;
  }

  for (let index = 0; index < text.length; index += chunkSize) {
    emit({
      type: "token",
      taskId,
      delta: text.slice(index, index + chunkSize),
    });
    // 让出事件循环，避免同步循环把 token 帧缓冲成「一次性显示」
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 16);
    });
  }
}

export function createTokenHandler(
  emit: StreamEmitter | undefined,
  taskId: string,
  streamedFlag: { value: boolean },
): (delta: string) => void {
  return (delta: string) => {
    if (!delta) {
      return;
    }

    streamedFlag.value = true;
    emit?.({ type: "token", taskId, delta });
  };
}
