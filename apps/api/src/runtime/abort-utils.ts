/**
 * AbortSignal 协作取消辅助（E.8）。
 * Planner 循环在「步进边界」调用 throwIfAborted，避免取消后继续调 LLM/工具。
 */
import { AppError } from "../shared/app-error.js";

/** signal 已 abort 时抛出 CANCELLED / TIMEOUT_ERROR（若 reason 已是 AppError 则原样抛出） */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;

  if (reason instanceof AppError) {
    throw reason;
  }

  if (reason instanceof Error && reason.name === "AbortError") {
    throw new AppError("CANCELLED", reason.message || "Task was cancelled.");
  }

  const message =
    typeof reason === "string" && reason.length > 0
      ? reason
      : reason instanceof Error
        ? reason.message
        : "Task was cancelled.";

  throw new AppError("CANCELLED", message);
}

/** 取消或超时：tasks.status 应写 cancelled，而不是 failed */
export function isTaskCancellation(error: unknown): boolean {
  if (!(error instanceof AppError)) {
    return false;
  }

  return error.code === "CANCELLED" || error.code === "TIMEOUT_ERROR";
}

/**
 * OpenAI / fetch 在 signal abort 时可能抛 AbortError 或 APIUserAbortError。
 * 统一转成 CANCELLED，避免被上层包成 LLM_ERROR 误标 failed。
 */
export function rethrowIfLlmAborted(error: unknown): void {
  if (error instanceof AppError && isTaskCancellation(error)) {
    throw error;
  }

  if (error instanceof Error) {
    const name = error.name;
    const message = error.message.toLowerCase();

    if (
      name === "AbortError" ||
      name === "APIUserAbortError" ||
      message.includes("request was aborted") ||
      message.includes("operation was aborted")
    ) {
      throw new AppError("CANCELLED", error.message || "LLM request was aborted.");
    }
  }
}
