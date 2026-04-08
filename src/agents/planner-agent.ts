import type { Agent, AgentContext, AgentRequest, AgentResponse } from "./base-agent.js";

export class PlannerAgent implements Agent {
  async plan(request: AgentRequest, context: AgentContext): Promise<AgentResponse> {
    const decision = await context.llm.plan({
      userInput: request.input,
      tools: context.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    });

    const toolCalls: AgentResponse["toolCalls"] = [];
    let finalAnswer = decision.finalAnswer;

    if (decision.needsTool && decision.toolName) {
      const tool = context.tools.find((item) => item.name === decision.toolName);

      if (tool) {
        const toolOutput = await tool.execute({
          input: decision.toolInput ?? request.input,
        });

        toolCalls.push({
          toolName: tool.name,
          output: toolOutput,
        });

        finalAnswer = `${decision.finalAnswer}\n\nTool result: ${toolOutput}`;
      }
    }

    await context.memory.append(request.taskId, {
      role: "assistant",
      content: finalAnswer,
      timestamp: new Date().toISOString(),
    });

    return {
      summary: finalAnswer,
      toolCalls,
    };
  }
}
