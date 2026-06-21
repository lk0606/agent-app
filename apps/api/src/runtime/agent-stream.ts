import type { AgentStreamEvent } from "@agent-app/api-contract";

export type StreamEmitter = (event: AgentStreamEvent) => void;

/** LLM 尚未真流式时，用完整回答切片模拟 token 推送，供前端逐段展示 */
export function emitTokenStream(emit: StreamEmitter, taskId: string, text: string, chunkSize = 12): void {
  if (text.length === 0) {
    return;
  }

  for (let index = 0; index < text.length; index += chunkSize) {
    emit({
      type: "token",
      taskId,
      delta: text.slice(index, index + chunkSize),
    });
  }
}

export function emitThinking(emit: StreamEmitter | undefined, taskId: string, step: number): void {
  emit?.({ type: "thinking", taskId, step });
}
