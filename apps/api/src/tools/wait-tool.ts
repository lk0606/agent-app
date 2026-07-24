/**
 * 可中断等待 Tool（E.8 手测/演示用）。
 * 用户说「等待 N 秒」时 Planner 选用；execute 按 100ms 切片 sleep，并检查 AbortSignal，
 * 这样 POST /tasks/:id/cancel 能在等待中途真正打断（不必等整段 sleep 结束）。
 */
import { AppError } from "../shared/app-error.js";
import { throwIfAborted } from "../runtime/abort-utils.js";
import type { Tool, ToolInput } from "./tool.js";

const DEFAULT_SECONDS = 10;
const SLICE_MS = 100;

export class WaitTool implements Tool {
  readonly name = "wait";
  readonly description =
    "Waits for a number of seconds before continuing. Pass a positive integer like 10 or 15. Use when the user explicitly asks to wait, sleep, or delay.";

  constructor(private readonly options: { maxSeconds: number }) {}

  async execute(input: ToolInput): Promise<string> {
    const seconds = this.parseSeconds(input.input);
    const totalMs = seconds * 1000;

    let elapsed = 0;

    while (elapsed < totalMs) {
      throwIfAborted(input.signal);

      const slice = Math.min(SLICE_MS, totalMs - elapsed);
      await sleep(slice);
      elapsed += slice;
    }

    throwIfAborted(input.signal);

    return `Waited ${seconds} second(s).`;
  }

  /** 从自然语言抽出秒数；默认 10；超过 maxSeconds 直接 BAD_REQUEST */
  private parseSeconds(rawInput: string): number {
    const match = rawInput.match(/(\d+(?:\.\d+)?)/);
    const parsed = match ? Number(match[1]) : DEFAULT_SECONDS;

    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new AppError("BAD_REQUEST", "WaitTool requires a positive number of seconds.");
    }

    const seconds = Math.ceil(parsed);

    if (seconds > this.options.maxSeconds) {
      throw new AppError(
        "BAD_REQUEST",
        `WaitTool max is ${this.options.maxSeconds} seconds; got ${seconds}.`,
      );
    }

    return seconds;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
