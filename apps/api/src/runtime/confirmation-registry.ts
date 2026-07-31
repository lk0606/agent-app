/**
 * E.10：人工确认挂起表（进程内 Promise）。
 * 与 RunningTaskRegistry 一样是单进程 Map：重启后 waiter 丢失，DB 可能仍停在 awaiting_confirmation。
 *
 * 常规执行顺序（跨模块）：
 * 1. Planner 选中 requiresConfirmation 工具（如 write_file）→ wait(taskId, payload)
 * 2. SSE `awaiting_confirmation`；tasks.status = awaiting_confirmation（autoApprove 时跳过）
 * 3. POST /tasks/:id/confirm { decision } → resolve(approve|reject) 唤醒 wait
 * 4. approve → Planner 继续 tool_start / execute；reject → 合成 HUMAN_REJECTED 回流 LLM
 * 旁路：cancel/超时 abort → wait reject CANCELLED；TaskRunner finally → clear 防泄漏
 * 孤儿：进程重启后 Map 空、DB 仍 awaiting → confirm 失败，用 cancel 直接落库 cancelled
 *
 * 本文件执行链路：见下方方法上的 [1]…[4]
 *   [1] wait → [2] resolve → [3] getPending/has → [4] clear
 */
import { AppError } from "../shared/app-error.js";

export type ConfirmationDecision = "approve" | "reject";

/** GET /tasks.pendingConfirmation 的载荷；存在进程内，不是 DB 列 */
export interface PendingConfirmationPayload {
  step: number;
  toolName: string;
  toolInput: string;
}

interface PendingEntry {
  payload: PendingConfirmationPayload;
  resolve: (decision: ConfirmationDecision) => void;
  reject: (error: unknown) => void;
  onAbort: () => void;
}

export class ConfirmationRegistry {
  private readonly pending = new Map<string, PendingEntry>();

  /**
   * [1] 挂起入口：阻塞直到 confirm resolve，或 signal abort。
   * @param autoApprove true 时立刻返回 approve（evals / 无 HTTP 确认方），不进 Map
   * 例：autoApprove → 同步 "approve"；手测 → 挂起直到 POST .../confirm
   */
  wait(
    taskId: string,
    payload: PendingConfirmationPayload,
    options?: { signal?: AbortSignal; autoApprove?: boolean },
  ): Promise<ConfirmationDecision> {
    // evals:run 强制走这条：不登记 waiter，避免无人 confirm 永久挂死
    if (options?.autoApprove) {
      return Promise.resolve("approve");
    }

    // 同一 task 不应二次 wait（Planner 单工具路径下基本不会；防编程错误）
    if (this.pending.has(taskId)) {
      return Promise.reject(
        new AppError("INTERNAL_ERROR", `Task "${taskId}" already has a pending confirmation.`),
      );
    }

    // 挂起前已 abort（cancel/超时抢在 wait 之前）→ 直接 CANCELLED，勿再进 Map
    if (options?.signal?.aborted) {
      return Promise.reject(
        new AppError("CANCELLED", "Task was cancelled before confirmation could start."),
      );
    }

    return new Promise<ConfirmationDecision>((resolve, reject) => {
      // cancel / 超时 / SSE 断开 → abort：从 Map 删掉并 reject，唤醒 Planner
      const onAbort = () => {
        this.pending.delete(taskId);
        const reason =
          options?.signal?.reason instanceof AppError
            ? options.signal.reason
            : new AppError("CANCELLED", `Task "${taskId}" was cancelled while awaiting confirmation.`);
        reject(reason);
      };

      this.pending.set(taskId, {
        payload,
        resolve: (decision) => {
          options?.signal?.removeEventListener("abort", onAbort);
          this.pending.delete(taskId);
          resolve(decision);
        },
        reject: (error) => {
          options?.signal?.removeEventListener("abort", onAbort);
          this.pending.delete(taskId);
          reject(error);
        },
        onAbort,
      });

      options?.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * [2] HTTP confirm 入口：唤醒 wait()。
   * @returns false = 无 waiter（已结束，或进程重启后的孤儿 awaiting）
   * 例：status 仍是 awaiting_confirmation 但 Map 空 → server 应 400 / 建议 cancel 清孤儿
   */
  resolve(taskId: string, decision: ConfirmationDecision): boolean {
    const entry = this.pending.get(taskId);

    if (!entry) {
      return false;
    }

    entry.resolve(decision);
    return true;
  }

  /** [3a] 供 GET /tasks 拼 pendingConfirmation；无 waiter 时 null（含已批准瞬间） */
  getPending(taskId: string): PendingConfirmationPayload | null {
    return this.pending.get(taskId)?.payload ?? null;
  }

  /** [3b] 查询是否仍有挂起 waiter（调试 / 断言用） */
  has(taskId: string): boolean {
    return this.pending.has(taskId);
  }

  /**
   * [4] TaskRunner finally / 孤儿 cancel：强制结束泄漏的 waiter。
   * 已 resolve/reject 的条目不在 Map 里，此处 no-op。
   */
  clear(taskId: string): void {
    const entry = this.pending.get(taskId);

    if (!entry) {
      return;
    }

    entry.reject(new AppError("CANCELLED", `Confirmation waiter for "${taskId}" was cleared.`));
  }
}
