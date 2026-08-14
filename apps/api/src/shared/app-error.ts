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
  /** E.13：Authorization 头缺失/不匹配 API_AUTH_TOKEN；与 BAD_REQUEST 区分，方便客户端识别「要不要弹登录」 */
  | "UNAUTHORIZED"
  /** E.13：单 IP 超出 RATE_LIMIT_MAX_REQUESTS / 窗口；客户端应退避重试，不是业务错误 */
  | "RATE_LIMITED"
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
