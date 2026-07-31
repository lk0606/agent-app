/**
 * E.9：任务级观测聚合器（进程内）。
 *
 * 常规执行顺序（跨模块）：
 * 1. HunyuanLlmClient 抽 usage → onLlmCall → recordLlmCall
 * 2. TaskRunner 结束（成功/失败/取消）→ persistMetrics → finalize → task_metrics 表
 * 3. GET /tasks/:id 读出 metrics 字段
 * 关联主键是 taskId；≠ plannerTrace、≠ OpenTelemetry traceId。
 * 旁路：usage 缺失时 token 记 0、估费可为 null；save 失败由 TaskRunner 吞掉不改 task status
 *
 * 本文件执行链路：见下方方法上的 [1]…[3]
 *   [1] constructor → [2] recordLlmCall（可多次）→ [3] finalize
 *
 * Token 从哪来：混元响应里的 usage（prompt_tokens / completion_tokens），
 * **不是**按字符数 string.length 自己算。
 */
export type LlmCallPurpose = "plan" | "answer" | "summarize";

export interface LlmTokenUsage {
  /** 发给模型的输入 token（system + user + tools 定义等） */
  promptTokens: number;
  /** 模型吐出来的输出 token */
  completionTokens: number;
  /** 通常 = prompt + completion；上游缺字段时我们自己相加 */
  totalTokens: number;
}

/** 单次混元 HTTP 调用的观测快照（由 HunyuanLlmClient 在 finally 里上报） */
export interface LlmCallMetrics {
  purpose: LlmCallPurpose;
  model: string;
  /** 上游没带回 usage 时为 null（仍会计入 llmCallCount，但不参与估费） */
  usage: LlmTokenUsage | null;
  durationMs: number;
}

export interface TaskMetricsPricing {
  /**
   * 每百万 prompt token 的估算美元。
   * 来自 env LLM_PRICE_PROMPT_PER_1M_USD；仅学习对照，非 TokenHub 真实账单。
   */
  promptPer1MUsd: number;
  /** 每百万 completion token；来自 LLM_PRICE_COMPLETION_PER_1M_USD */
  completionPer1MUsd: number;
}

export interface TaskMetricsRecord {
  taskId: string;
  durationMs: number;
  llmCallCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  toolCallCount: number;
  plannerStepCount: number;
  /** 学习用估算 USD；整任务没有任何 usage 时为 null */
  estimatedCostUsd: number | null;
  llmCalls: Array<{
    purpose: LlmCallPurpose;
    model: string;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    durationMs: number;
  }>;
}

export class TaskMetricsCollector {
  private readonly startedAt = Date.now();
  private readonly llmCalls: LlmCallMetrics[] = [];

  /** [1] TaskRunner.run 开头创建；pricing 来自 env 单价 */
  constructor(
    private readonly taskId: string,
    private readonly pricing: TaskMetricsPricing,
  ) {}

  /** [2] 每次 plan / answer / summarize HTTP 结束时由 onLlmCall 调用（可多次） */
  recordLlmCall(call: LlmCallMetrics): void {
    this.llmCalls.push(call);
  }

  /**
   * [3] 任务结束（成功 / 失败 / 取消）时汇总成一行 task_metrics。
   *
   * toolCallCount / plannerStepCount 由 TaskRunner 从 DB 列表 .length 传入：
   * Collector 自己只攒 LLM 调用，不维护工具/规划步数，避免与落库真相分叉。
   */
  finalize(input: { toolCallCount: number; plannerStepCount: number }): TaskMetricsRecord {
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let hasAnyUsage = false;

    for (const call of this.llmCalls) {
      // 无 usage 的调用仍保留在 llmCalls 明细里，但不进 token 合计 / 估费
      if (!call.usage) {
        continue;
      }

      hasAnyUsage = true;
      promptTokens += call.usage.promptTokens;
      completionTokens += call.usage.completionTokens;
      totalTokens += call.usage.totalTokens;
    }

    const estimatedCostUsd = hasAnyUsage
      ? estimateCostUsd(promptTokens, completionTokens, this.pricing)
      : null;

    return {
      taskId: this.taskId,
      durationMs: Date.now() - this.startedAt,
      llmCallCount: this.llmCalls.length,
      promptTokens,
      completionTokens,
      totalTokens,
      toolCallCount: input.toolCallCount,
      plannerStepCount: input.plannerStepCount,
      estimatedCostUsd,
      llmCalls: this.llmCalls.map((call) => ({
        purpose: call.purpose,
        model: call.model,
        promptTokens: call.usage?.promptTokens ?? null,
        completionTokens: call.usage?.completionTokens ?? null,
        totalTokens: call.usage?.totalTokens ?? null,
        durationMs: call.durationMs,
      })),
    };
  }
}

/**
 * 估算费用（野路子理解）：
 *
 * 供应商按「百万 token」报价。我们把次数先除以 1_000_000，再乘单价。
 * prompt 与 completion 单价可以不同（输出通常更贵）。
 *
 * 公式：
 *   cost = promptTokens/1e6 * promptPer1MUsd
 *        + completionTokens/1e6 * completionPer1MUsd
 *
 * 假数字手算（默认 env：prompt=$0.5/M，completion=$1.5/M）：
 *   prompt=1271，completion=46
 *   → 1271/1e6 * 0.5 = 0.0006355
 *   → 46/1e6 * 1.5   = 0.000069
 *   → 合计 ≈ 0.0007045 美元
 *   （与 smoke:metrics 一次 time 任务量级一致）
 *
 * 再极端一点：刚好 100 万 prompt、0 completion → 正好 $0.5。
 *
 * 注意：这是学习占位价，改 env 只改变「估算」；真实账单以 TokenHub 控制台为准。
 */
export function estimateCostUsd(
  promptTokens: number,
  completionTokens: number,
  pricing: TaskMetricsPricing,
): number {
  const raw =
    (promptTokens / 1_000_000) * pricing.promptPer1MUsd +
    (completionTokens / 1_000_000) * pricing.completionPer1MUsd;
  // 保留 8 位小数，与 task_metrics.estimated_cost_usd numeric(14,8) 对齐
  return Math.round(raw * 1e8) / 1e8;
}

/**
 * OpenAI 兼容 usage → 统一 camelCase。
 * usage 整体缺失 → null（调用方知道「没拿到用量」）；
 * 字段缺一个 → 当 0（避免 NaN 污染合计）。
 */
export function readLlmTokenUsage(usage: {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
} | null | undefined): LlmTokenUsage | null {
  if (!usage) {
    return null;
  }

  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  const totalTokens =
    typeof usage.total_tokens === "number" ? usage.total_tokens : promptTokens + completionTokens;

  return { promptTokens, completionTokens, totalTokens };
}
