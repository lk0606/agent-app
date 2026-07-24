/**
 * 统一业务错误类型；HTTP 层用 classifyError 转成 JSON { error: { code, message } }。
 */
export type ErrorCode =
  | "CONFIG_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT_ERROR"
  /** 用户/客户端主动取消任务（E.8）；落库 tasks.status=cancelled */
  | "CANCELLED"
  | "TOOL_ERROR"
  | "LLM_ERROR"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function classifyError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    // fetch/OpenAI SDK 在 AbortSignal 触发时抛 AbortError
    if (error.name === "AbortError") {
      return new AppError("CANCELLED", error.message || "Task was cancelled.");
    }

    const message = error.message.toLowerCase();

    if (message.includes("timeout")) {
      return new AppError("TIMEOUT_ERROR", error.message);
    }

    if (message.includes("connection") || message.includes("network") || message.includes("fetch failed")) {
      return new AppError("NETWORK_ERROR", error.message);
    }

    return new AppError("INTERNAL_ERROR", error.message);
  }

  return new AppError("INTERNAL_ERROR", "Unknown error", { error });
}
