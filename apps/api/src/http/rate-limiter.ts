/**
 * 按客户端 IP 的固定窗口限流器（E.13）。
 * 进程内内存 Map：单实例 Node 进程够用；多实例部署需改成 Redis 等共享计数。
 *
 * 常规执行顺序（跨模块）：
 * 1. server.ts 每个请求（/health 除外）进来先 check(ip)
 * 2. 窗口内计数超过 maxRequests → 抛 AppError("RATE_LIMITED")，HTTP 层映射 429
 * 3. 窗口过期后下一次 check 会重置该 IP 的计数
 * 4. 后台定时 sweep 清掉过期条目，避免 Map 无限增长（长连接/长期运行进程）
 *
 * 本文件执行链路：见下方方法上的 [1]…[3]
 *   [1] check → [2]（内部）resetIfExpired → [3] sweep
 */
import { AppError } from "../shared/app-error.js";

interface WindowCounter {
  count: number;
  windowStartedAt: number;
}

export class RateLimiter {
  private readonly counters = new Map<string, WindowCounter>();
  private readonly sweepIntervalHandle: NodeJS.Timeout;

  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number,
  ) {
    // 每 10 个窗口 sweep 一次；间隔太短没意义，太长会让下线的 IP 长期占内存
    this.sweepIntervalHandle = setInterval(() => this.sweep(), windowMs * 10).unref();
  }

  /** [1] 请求入口调用；超限抛错，未超限静默返回并计数 +1 */
  check(clientKey: string): void {
    const now = Date.now();
    const existing = this.counters.get(clientKey);

    // [2] 首次访问或窗口已过期：开新窗口计数为 1
    if (!existing || now - existing.windowStartedAt >= this.windowMs) {
      // clientKey ip
      this.counters.set(clientKey, { count: 1, windowStartedAt: now });
      return;
    }

    if (existing.count >= this.maxRequests) {
      const retryAfterMs = this.windowMs - (now - existing.windowStartedAt);
      throw new AppError("RATE_LIMITED", `Rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`, {
        retryAfterMs,
      });
    }

    existing.count += 1;
  }

  /** [3] 清掉早已过期窗口的条目，防止长期运行进程 Map 无限增长 */
  private sweep(): void {
    const now = Date.now();

    for (const [key, counter] of this.counters) {
      if (now - counter.windowStartedAt >= this.windowMs) {
        this.counters.delete(key);
      }
    }
  }

  /** 进程关闭时释放定时器（server.ts shutdown 调用，避免 nodemon 重启后残留） */
  dispose(): void {
    clearInterval(this.sweepIntervalHandle);
  }
}
