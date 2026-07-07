/**
 * TaskRunner：一次 HTTP 请求的「外壳」。
 * 负责 tasks/messages 表的生命周期（创建 → running → succeeded/failed），
 * 真正的规划循环在 PlannerAgent.plan() 里。
 */
import type { Agent, AgentRequest, AgentResponse } from "../agents/base-agent.js";
import type { LlmClient } from "../llm/llm-client.js";
import type { MemoryStore } from "../memory/memory-store.js";
import { classifyError } from "../shared/app-error.js";
import type { Logger } from "../shared/logger.js";
import type { StreamEmitter } from "./agent-stream.js";
import type { Tool } from "../tools/tool.js";

export interface TaskRunnerDeps {
  agent: Agent;
  tools: Tool[];
  memory: MemoryStore;
  llm: LlmClient;
  logger: Logger;
}

export class TaskRunner {
  constructor(private readonly deps: TaskRunnerDeps) {}

  /**
   * 托管一次任务的生命周期：建任务 → 写用户消息 → 跑 Agent → 落最终状态。
   * emitStream 仅 POST /agent/stream 注入，用于 SSE 推送进行中事件；/agent/run 不传。
   */
  async run(request: AgentRequest, options?: { emitStream?: StreamEmitter }): Promise<AgentResponse> {
    const logger = this.deps.logger.child({ taskId: request.taskId });

    logger.info("Task started", { input: request.input });

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

      // 4. 核心：Planner 循环（plan → 可选工具 → answer）；emitStream 透传给 SSE
      const result = await this.deps.agent.plan(request, {
        tools: this.deps.tools,
        memory: this.deps.memory,
        llm: this.deps.llm,
        logger,
        emitStream: options?.emitStream,
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

      // 6. 失败收尾：tasks.status=failed，记录 errorCode/errorMessage 供调试面板
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
    }
  }
}
