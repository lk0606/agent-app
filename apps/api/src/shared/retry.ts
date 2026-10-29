import { throwIfAborted } from "../runtime/abort-utils.js";

/** 通用重试策略；只负责“何时再试”，具体哪些错误可重试由调用方决定。 */
export interface RetryOptions {
  /** 首次调用之外最多再试几次；例如 2 表示总 attempt 上限为 3。 */
  maxRetries: number;
  /**
   * 指数退避（exponential backoff）的基础等待上限，单位毫秒。
   * “退避”指失败后先等待再重试；“指数”指等待上限随重试次数按 2 的幂增长。
   * 第 n 次重试（n 从 1 开始）的上限：cap_n = min(maxDelayMs, baseDelayMs × 2^(n - 1))。
   * 若指数序号 k 从 0 开始，也可写成 baseDelayMs × 2^k；代码中 k = attempt - 1。
   * 例如 baseDelayMs=250，前四次重试的未封顶上限为 250、500、1000、2000ms。
   * 这是等待上限而非实际等待时长；full jitter 会在 [0, cap_n) 中随机取值。
   */
  baseDelayMs: number;
  /** 单次等待的本地上限，防止指数增长导致等待失控。 */
  maxDelayMs: number;
  /** 任务级取消/超时信号：既阻止下一次 attempt，也能中断等待。 */
  signal?: AbortSignal;
  /** 错误分类安全门；返回 false 时立即原样抛出，不再重试。 */
  shouldRetry(error: unknown): boolean;
  /** 可从 429 等响应读取 Retry-After；没有服务端建议时返回 null。 */
  getRetryAfterMs?: (error: unknown) => number | null;
  /** 真正等待前触发，用于记录 attempt、延迟和错误摘要，不写业务记录。 */
  onRetry?: (event: { attempt: number; maxAttempts: number; delayMs: number; error: unknown }) => void;
  /** 注入随机数生成器，仅用于让 full-jitter 的测试结果可预测。 */
  random?: () => number;
  /** 注入等待函数便于测试；生产默认使用可被 AbortSignal 打断的 abortableSleep。 */
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * 执行一个可能失败的异步操作。
 * full-jitter 指数退避 = 指数退避（exponential backoff）+ 全范围随机抖动（full jitter）。
 * 指数退避：失败越多，等待上限按 2 的幂增长，并由 maxDelayMs 封顶。
 * 全范围随机抖动：在整个 [0, 上限) 范围随机选择实际等待时间，而非所有请求固定等待相同时长。
 * “惊群”（thundering herd）：大量等待者被同一事件同时唤醒/触发，集中争抢资源；
 * 此处指大量客户端在相同退避时间结束后一起重试，形成请求洪峰，可能让服务再次过载。
 * 随机抖动将重试时间分散开，从而缓解惊群；有 Retry-After 时使用服务端建议的等待时间。
 */
export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxRetries) + 1);
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? abortableSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // attempt 开始前先检查，避免任务已取消却又发起一次外部请求。
    throwIfAborted(options.signal);

    try {
      return await operation(attempt);
    } catch (error: unknown) {
      // operation 可能正是因为 signal 中止而抛错；优先保留 CANCELLED/TIMEOUT 语义。
      throwIfAborted(options.signal);

      if (attempt >= maxAttempts || !options.shouldRetry(error)) {
        throw error;
      }

      // 指数退避：第 1/2/3 次失败后的等待上限依次为 base × 1/2/4，并受 maxDelayMs 封顶。
      const exponentialCap = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * 2 ** (attempt - 1),
      );
      const retryAfterMs = options.getRetryAfterMs?.(error) ?? null;
      // full jitter：不固定等待 exponentialCap，而是在 0 到该上限之间随机取值。
      // 若服务端给了 Retry-After，则优先使用服务端建议，但仍受本地最大等待限制。
      const delayMs = retryAfterMs === null
        ? Math.floor(Math.max(0, random()) * exponentialCap)
        : Math.min(options.maxDelayMs, Math.max(0, retryAfterMs));

      options.onRetry?.({ attempt, maxAttempts, delayMs, error });
      // backoff sleep：下一次 attempt 前的退避等待；signal 中止时无需等满 delayMs。
      await sleep(delayMs, options.signal);
    }
  }

  throw new Error("Retry loop exhausted unexpectedly.");
}

/**
 * 可取消的退避等待（backoff sleep）。它不是业务耗时，而是失败后主动暂停一段时间，
 * 给远端服务恢复/解除限流的机会；任务取消时会清掉定时器并立即 reject。
 */
export function abortableSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      try {
        throwIfAborted(signal);
      } catch (error: unknown) {
        reject(error);
      }
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
