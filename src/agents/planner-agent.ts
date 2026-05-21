import { AppError } from "../shared/app-error.js";
import type { Agent, AgentContext, AgentRequest, AgentResponse } from "./base-agent.js";

type LlmConversationMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
};

export class PlannerAgent implements Agent {
  constructor(
    private readonly options: {
      maxSteps: number;
      toolCallBudget: number;
      sessionHistoryMessageLimit: number;
      sessionHistoryCharBudget: number;
    },
  ) {}

  // 执行一次 agent 规划循环：模型决定是否用工具，工具结果再回到模型生成最终回答。
  async plan(request: AgentRequest, context: AgentContext): Promise<AgentResponse> {
    const sessionContext = request.sessionId
      ? await this.buildSessionContext(request, context)
      : { recentHistory: [] as LlmConversationMessage[], sessionSummary: null as string | null };
    const toolCalls: AgentResponse["toolCalls"] = [];
    let finalAnswer = "";

    for (let step = 0; step < this.options.maxSteps; step += 1) {
      const decision = await context.llm.plan({
        sessionSummary: sessionContext.sessionSummary,
        conversationHistory: sessionContext.recentHistory,
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
            sessionSummary: sessionContext.sessionSummary,
            conversationHistory: sessionContext.recentHistory,
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
          sessionSummary: sessionContext.sessionSummary,
          conversationHistory: sessionContext.recentHistory,
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
        sessionSummary: sessionContext.sessionSummary,
        conversationHistory: sessionContext.recentHistory,
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

  // 组装喂给模型的会话上下文：旧内容走持久化摘要，最近内容保留原文。
  private async buildSessionContext(request: AgentRequest, context: AgentContext): Promise<{
    sessionSummary: string | null;
    recentHistory: LlmConversationMessage[];
  }> {
    const sessionId = request.sessionId!;
    const [session, allMessages] = await Promise.all([
      context.memory.getSession(sessionId),
      context.memory.listAllSessionMessages(sessionId),
    ]);
    const llmMessages = this.toLlmConversationMessages(allMessages, request.taskId);
    // 最近窗口保留原文，较早历史交给 summary；这样追问细节和长会话成本能兼顾。
    const recentHistory = this.applyCharBudget(llmMessages.slice(-this.options.sessionHistoryMessageLimit));
    const olderMessages = llmMessages.slice(0, Math.max(0, llmMessages.length - recentHistory.length));

    if (olderMessages.length === 0) {
      return {
        sessionSummary: null,
        recentHistory,
      };
    }

    const currentSummary = session?.summary ?? null;
    const currentSummaryMessageCount = session?.summaryMessageCount ?? 0;
    const hasReusableSummary = Boolean(currentSummary);
    const summaryNeedsOnlyNewMessages = hasReusableSummary && currentSummaryMessageCount < olderMessages.length;

    // summary_message_count 表示现有 summary 已覆盖的旧消息数，可避免每次从头总结整段会话。
    if (currentSummary && currentSummaryMessageCount === olderMessages.length) {
      return {
        sessionSummary: currentSummary,
        recentHistory,
      };
    }

    // 如果已有 summary，只把它尚未覆盖的新旧消息拿去合并总结；否则首次总结全部旧消息。
    const messagesToSummarize = summaryNeedsOnlyNewMessages
      ? olderMessages.slice(currentSummaryMessageCount)
      : olderMessages;
    const sessionSummary = await context.llm.summarizeSession({
      // 只有增量更新时才传 existingSummary，避免把过期或不匹配的摘要混进首次总结。
      existingSummary: summaryNeedsOnlyNewMessages ? currentSummary : null,
      messages: this.applyCharBudget(messagesToSummarize, this.options.sessionHistoryCharBudget * 2),
      currentUserInput: request.input,
    });

    await context.memory.updateSession(sessionId, {
      summary: sessionSummary,
      summaryMessageCount: olderMessages.length,
      summaryUpdatedAt: new Date().toISOString(),
    });

    return {
      sessionSummary,
      recentHistory,
    };
  }

  // 存储层会保留 system 等内部消息，这里只挑出适合进入模型上下文的角色。
  private toLlmConversationMessages(
    conversationHistory: Awaited<ReturnType<AgentContext["memory"]["listSessionMessages"]>>,
    currentTaskId: string,
  ): LlmConversationMessage[] {
    return conversationHistory
      .filter(
        (item): item is typeof item & { role: LlmConversationMessage["role"] } =>
          item.taskId !== currentTaskId && (item.role === "user" || item.role === "assistant" || item.role === "tool"),
      )
      .map((item) => ({
        role: item.role,
        content: item.content,
      }));
  }

  // 给模型输入做字符预算控制，避免长会话把上下文无限撑大。
  private applyCharBudget(
    conversationHistory: LlmConversationMessage[],
    charBudget = this.options.sessionHistoryCharBudget,
  ): LlmConversationMessage[] {
    const result: LlmConversationMessage[] = [];
    let remainingChars = charBudget;

    // 从最新消息往前保留，预算不足时优先牺牲更早的上下文。
    for (let index = conversationHistory.length - 1; index >= 0; index -= 1) {
      const item = conversationHistory[index];

      if (remainingChars <= 0) {
        break;
      }

      const content = item.content.length > remainingChars ? item.content.slice(-remainingChars) : item.content;

      result.unshift({
        role: item.role,
        content,
      });

      remainingChars -= content.length;
    }

    return result;
  }
}
