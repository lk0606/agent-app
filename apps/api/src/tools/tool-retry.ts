import { AppError } from "../shared/app-error.js";
import type { Logger } from "../shared/logger.js";
import { withRetry } from "../shared/retry.js";
import type { Tool, ToolInput } from "./tool.js";

export interface ToolRetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  logger?: Logger;
}

/** 仅幂等 Tool 的显式瞬态网络错误可重试；取消、任务超时和业务错误始终只执行一次。 */
export function executeToolWithRetry(
  tool: Tool,
  input: ToolInput,
  options: ToolRetryOptions,
): Promise<string> {
  return withRetry(() => tool.execute(input), {
    maxRetries: tool.idempotent ? options.maxRetries : 0,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
    signal: input.signal,
    shouldRetry: (error) => error instanceof AppError && error.code === "NETWORK_ERROR",
    onRetry: ({ attempt, maxAttempts, delayMs, error }) => {
      options.logger?.info("Tool execution retry scheduled", {
        toolName: tool.name,
        attempt,
        maxAttempts,
        delayMs,
        errorCode: error instanceof AppError ? error.code : "UNKNOWN",
      });
    },
  });
}
