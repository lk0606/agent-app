import type { Agent, AgentContext, AgentRequest, AgentResponse } from "./base-agent.js";

export class PlannerAgent implements Agent {
  async plan(request: AgentRequest, context: AgentContext): Promise<AgentResponse> {
    const echoTool = context.tools.find((tool) => tool.name === "echo");

    if (!echoTool) {
      return {
        summary: "No available tools were found for the task.",
        toolCalls: [],
      };
    }

    const toolOutput = await echoTool.execute({
      input: `Planner received task: ${request.input}`,
    });

    await context.memory.append(request.taskId, {
      role: "assistant",
      content: toolOutput,
      timestamp: new Date().toISOString(),
    });

    return {
      summary: "The agent created a minimal plan and executed the echo tool successfully.",
      toolCalls: [
        {
          toolName: echoTool.name,
          output: toolOutput,
        },
      ],
    };
  }
}
