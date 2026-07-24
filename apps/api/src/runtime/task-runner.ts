/**
 * TaskRunner：一次 HTTP 请求的「外壳」。
 * 负责 tasks/messages 表的生命周期（创建 → running → succeeded/failed/cancelled），
 * 真正的规划循环在 PlannerAgent.plan() 里。
 *
 * E.8：为每次 run 建 AbortController，登记到 RunningTaskRegistry；
 * 超时 / POST cancel / SSE 断开 → abort → Planner 协作退出 → status=cancelled。
 */
import type { Agent, AgentRequest, AgentResponse } from "../agents/base-agent.js";
import type { LlmClient } from "../llm/llm-client.js";
import type { MemoryStore } from "../memory/memory-store.js";
import { AppError, classifyError } from "../shared/app-error.js";
import type { Logger } from "../shared/logger.js";
import { isTaskCancellation } from "./abort-utils.js";
import type { StreamEmitter } from "./agent-stream.js";
import type { RunningTaskRegistry } from "./running-task-registry.js";
import type { Tool } from "../tools/tool.js";

export interface TaskRunnerDeps {
  agent: Agent;
  tools: Tool[];
  memory: MemoryStore;
  llm: LlmClient;
  logger: Logger;
  /** 供 cancel API 按 taskId abort */
  runningTasks: RunningTaskRegistry;
  /** 默认整任务超时（ms）；null/undefined 表示不启用，可被单次 run 的 timeoutMs 覆盖 */
  defaultTimeoutMs?: number | null;
}

export class TaskRunner {
  constructor(private readonly deps: TaskRunnerDeps) {}

  /**
   * 托管一次任务的生命周期：建任务 → 写用户消息 → 跑 Agent → 落最终状态。
   * emitStream 仅 POST /agent/stream 注入；signal 可把外部 abort（如 SSE close）并入本任务控制器。
   */
  async run(
    request: AgentRequest,
    options?: {
      emitStream?: StreamEmitter;
      /** 外部信号（如 HTTP 请求关闭）并入本任务 AbortController */
      signal?: AbortSignal;
      /** 覆盖 defaultTimeoutMs；传正数启用超时 */
      timeoutMs?: number | null;
    },
  ): Promise<AgentResponse> {
    const logger = this.deps.logger.child({ taskId: request.taskId });
    const controller = new AbortController();
    this.deps.runningTasks.register(request.taskId, controller);

    const onExternalAbort = () => {
      if (!controller.signal.aborted) {
        const reason =
          options?.signal?.reason instanceof AppError
            ? options.signal.reason
            : new AppError("CANCELLED", "Client disconnected or external abort.");
        controller.abort(reason);
      }
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        onExternalAbort();
      } else {
        options.signal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }

    const timeoutMs = options?.timeoutMs ?? this.deps.defaultTimeoutMs ?? null;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        if (!controller.signal.aborted) {
          controller.abort(
            new AppError("TIMEOUT_ERROR", `Task exceeded timeout of ${timeoutMs}ms.`),
          );
        }
      }, timeoutMs);
      timeoutHandle.unref?.();
    }

    logger.info("Task started", { input: request.input, timeoutMs: timeoutMs ?? null });

    try {
      // 1. tasks 表落一行 running，供 GET /tasks/:id 观测状态
      await this.deps.memory.createTask({
        id: request.taskId,
        sessionId: request.sessionId ?? null,
        input: request.input,
        status: "running",
      });

      // 2. 有 session 时刷新 lastTaskAt，左栏列表按最近活动排序
      if (request.sessionId) {
        await this.deps.memory.updateSession(request.sessionId, {
          lastTaskAt: new Date().toISOString(),
        });
      }

      // 3. messages 表写入本轮 user 消息，Planner 读历史上下文用
      await this.deps.memory.append(request.taskId, {
        role: "user",
        content: request.input,
        timestamp: new Date().toISOString(),
      });

      // 4. 核心：Planner 循环；signal 供步进边界协作取消
      const result = await this.deps.agent.plan(request, {
        tools: this.deps.tools,
        memory: this.deps.memory,
        llm: this.deps.llm,
        logger,
        emitStream: options?.emitStream,
        signal: controller.signal,
      });

      const timeline = await this.deps.memory.list(request.taskId);

      logger.info("Task finished", {
        summary: result.summary,
        timelineLength: timeline.length,
        toolCallCount: result.toolCalls.length,
      });

      // 5. 成功收尾：tasks.status=succeeded，写入 summary
      await this.deps.memory.updateTask(request.taskId, {
        status: "succeeded",
        summary: result.summary,
        finishedAt: new Date().toISOString(),
      });

      return result;
    } catch (error: unknown) {
      const appError = classifyError(error);

      // 6. 取消/超时 → cancelled；其它业务错误 → failed（调试面板靠 status 区分）
      if (isTaskCancellation(appError)) {
        await this.deps.memory.updateTask(request.taskId, {
          status: "cancelled",
          errorCode: appError.code,
          errorMessage: appError.message,
          finishedAt: new Date().toISOString(),
        });

        logger.info("Task cancelled", {
          code: appError.code,
          message: appError.message,
        });
        throw appError;
      }

      await this.deps.memory.updateTask(request.taskId, {
        status: "failed",
        errorCode: appError.code,
        errorMessage: appError.message,
        finishedAt: new Date().toISOString(),
      });

      logger.error("Task failed", {
        code: appError.code,
        message: appError.message,
        details: appError.details,
      });
      throw appError;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (options?.signal) {
        options.signal.removeEventListener("abort", onExternalAbort);
      }

      this.deps.runningTasks.unregister(request.taskId);
    }
  }
}
