import type { Agent, AgentRequest, AgentResponse } from "../agents/base-agent.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { Logger } from "../shared/logger.js";
import type { Tool } from "../tools/tool.js";

export interface TaskRunnerDeps {
  agent: Agent;
  tools: Tool[];
  memory: MemoryStore;
  logger: Logger;
}

export class TaskRunner {
  constructor(private readonly deps: TaskRunnerDeps) {}

  async run(request: AgentRequest): Promise<AgentResponse> {
    this.deps.logger.info("Task started", { taskId: request.taskId, input: request.input });

    await this.deps.memory.append(request.taskId, {
      role: "user",
      content: request.input,
      timestamp: new Date().toISOString(),
    });

    const result = await this.deps.agent.plan(request, {
      tools: this.deps.tools,
      memory: this.deps.memory,
    });

    const timeline = await this.deps.memory.list(request.taskId);

    this.deps.logger.info("Task finished", {
      taskId: request.taskId,
      summary: result.summary,
      timelineLength: timeline.length,
    });

    return result;
  }
}
