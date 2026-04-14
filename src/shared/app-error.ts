export type ErrorCode =
  | "CONFIG_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT_ERROR"
  | "TOOL_ERROR"
  | "LLM_ERROR"
  | "BAD_REQUEST"
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
