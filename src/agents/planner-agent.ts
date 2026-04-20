import { AppError } from "../shared/app-error.js";
import type { Agent, AgentContext, AgentRequest, AgentResponse } from "./base-agent.js";

export class PlannerAgent implements Agent {
  constructor(private readonly options: { maxSteps: number; toolCallBudget: number }) {}

  async plan(request: AgentRequest, context: AgentContext): Promise<AgentResponse> {
    const toolCalls: AgentResponse["toolCalls"] = [];
    let finalAnswer = "";

    for (let step = 0; step < this.options.maxSteps; step += 1) {
      const decision = await context.llm.plan({
        userInput: request.input,
        tools: context.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
        previousToolCalls: toolCalls.map((call) => ({
          toolName: call.toolName,
          toolInput: call.input,
          toolOutput: call.output,
        })),
      });

      context.logger.info("Planner step decided", {
        step: step + 1,
        needsTool: decision.needsTool,
        toolName: decision.toolName,
      });

      if (!decision.needsTool || !decision.toolName) {
        finalAnswer = decision.draftAnswer;
        break;
      }

      if (toolCalls.length >= this.options.toolCallBudget) {
        context.logger.info("Tool budget reached", {
          toolCallBudget: this.options.toolCallBudget,
          attemptedToolName: decision.toolName,
        });

        const lastCall = toolCalls[toolCalls.length - 1];

        if (lastCall) {
          finalAnswer = await context.llm.answerWithTool({
            userInput: request.input,
            toolName: lastCall.toolName,
            toolInput: lastCall.input,
            toolOutput: lastCall.output,
          });
          break;
        }
      }

      const tool = context.tools.find((item) => item.name === decision.toolName);

      if (!tool) {
        throw new AppError("TOOL_ERROR", `Requested tool "${decision.toolName}" is not registered.`);
      }

      const toolInput = decision.toolInput ?? request.input;
      const existingCall = toolCalls.find((call) => call.toolName === tool.name && call.input === toolInput);

      if (existingCall) {
        context.logger.info("Duplicate tool call skipped", {
          step: step + 1,
          toolName: tool.name,
          toolInput,
        });

        finalAnswer = await context.llm.answerWithTool({
          userInput: request.input,
          toolName: existingCall.toolName,
          toolInput: existingCall.input,
          toolOutput: existingCall.output,
        });
        break;
      }

      context.logger.info("Tool execution started", {
        step: step + 1,
        toolName: tool.name,
        toolInput,
      });

      const startedAt = new Date().toISOString();

      try {
        const toolOutput = await tool.execute({
          input: toolInput,
        });

        context.logger.info("Tool execution finished", {
          step: step + 1,
          toolName: tool.name,
          outputPreview: toolOutput.slice(0, 240),
        });

        await context.memory.append(request.taskId, {
          role: "tool",
          content: `[${tool.name}] ${toolOutput}`,
          timestamp: new Date().toISOString(),
        });

        await context.memory.recordToolCall({
          taskId: request.taskId,
          step: step + 1,
          toolName: tool.name,
          toolInput,
          toolOutput,
          status: "succeeded",
          createdAt: startedAt,
          finishedAt: new Date().toISOString(),
        });

        toolCalls.push({
          toolName: tool.name,
          input: toolInput,
          output: toolOutput,
        });
      } catch (error: unknown) {
        await context.memory.recordToolCall({
          taskId: request.taskId,
          step: step + 1,
          toolName: tool.name,
          toolInput,
          status: "failed",
          errorCode: error instanceof AppError ? error.code : "TOOL_ERROR",
          errorMessage: error instanceof Error ? error.message : String(error),
          createdAt: startedAt,
          finishedAt: new Date().toISOString(),
        });

        throw error;
      }
    }

    if (!finalAnswer) {
      const lastCall = toolCalls[toolCalls.length - 1];

      if (!lastCall) {
        throw new AppError("INTERNAL_ERROR", "Agent ended without a final answer or tool call.");
      }

      finalAnswer = await context.llm.answerWithTool({
        userInput: request.input,
        toolName: lastCall.toolName,
        toolInput: lastCall.input,
        toolOutput: lastCall.output,
      });
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
