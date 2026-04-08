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
    let finalAnswer = decision.draftAnswer;

    if (decision.needsTool && decision.toolName) {
      const tool = context.tools.find((item) => item.name === decision.toolName);

      if (tool) {
        const toolInput = decision.toolInput ?? request.input;
        const toolOutput = await tool.execute({
          input: toolInput,
        });

        toolCalls.push({
          toolName: tool.name,
          output: toolOutput,
        });

        finalAnswer = await context.llm.answerWithTool({
          userInput: request.input,
          toolName: tool.name,
          toolInput,
          toolOutput,
        });
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
