import type { Agent, AgentRequest, AgentResponse } from "../agents/base-agent.js";
import type { LlmClient } from "../llm/llm-client.js";
import type { MemoryStore } from "../memory/memory-store.js";
import { classifyError } from "../shared/app-error.js";
import type { Logger } from "../shared/logger.js";
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

  async run(request: AgentRequest): Promise<AgentResponse> {
    const logger = this.deps.logger.child({ taskId: request.taskId });

    logger.info("Task started", { input: request.input });

    try {
      await this.deps.memory.append(request.taskId, {
        role: "user",
        content: request.input,
        timestamp: new Date().toISOString(),
      });

      const result = await this.deps.agent.plan(request, {
        tools: this.deps.tools,
        memory: this.deps.memory,
        llm: this.deps.llm,
        logger,
      });

      const timeline = await this.deps.memory.list(request.taskId);

      logger.info("Task finished", {
        summary: result.summary,
        timelineLength: timeline.length,
        toolCallCount: result.toolCalls.length,
      });

      return result;
    } catch (error: unknown) {
      const appError = classifyError(error);
      logger.error("Task failed", {
        code: appError.code,
        message: appError.message,
        details: appError.details,
      });
      throw appError;
    }
  }
}
