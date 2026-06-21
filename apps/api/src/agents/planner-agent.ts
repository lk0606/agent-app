import type { RecordPlannerStepInput } from "../memory/memory-store.js";
import {
  createTokenHandler,
  emitPlannerDecision,
  emitTokenStream,
} from "../runtime/agent-stream.js";
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
    const streamedFlag = { value: false };

    for (let step = 0; step < this.options.maxSteps; step += 1) {
      const stepNumber = step + 1;
      const stepStartedAt = Date.now();
      const stepCreatedAt = new Date(stepStartedAt).toISOString();

      // plan() 期间 UI 只显示通用 loading；决策内容在 planner_decision 事件里展示。
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

      emitPlannerDecision(context.emitStream, request.taskId, stepNumber, decision);

      context.logger.info("Planner step decided", {
        step: stepNumber,
        needsTool: decision.needsTool,
        toolName: decision.toolName,
      });

      const recordStep = async (input: Omit<RecordPlannerStepInput, "taskId" | "step" | "createdAt">) => {
        // 与 tool_calls 不同：这里记录的是「规划决策」，不是工具执行结果（见 GET /tasks plannerTrace）。
        await context.memory.recordPlannerStep({
          taskId: request.taskId,
          step: stepNumber,
          createdAt: stepCreatedAt,
          ...input,
        });
      };

      if (!decision.needsTool || !decision.toolName) {
        // 已有工具结果时走 answerWithTool 真流式，而不是 plan() 返回的 draftAnswer。
        if (toolCalls.length > 0) {
          finalAnswer = await this.answerFromToolResult(
            context,
            request,
            sessionContext,
            toolCalls[toolCalls.length - 1]!,
            streamedFlag,
          );
        } else {
          finalAnswer = decision.draftAnswer;
        }

        await recordStep({
          needsTool: decision.needsTool,
          toolName: decision.toolName ?? null,
          toolInput: null,
          outcome: "direct_answer",
          durationMs: Date.now() - stepStartedAt,
          finishedAt: new Date().toISOString(),
        });

        break;
      }

      if (toolCalls.length >= this.options.toolCallBudget) {
        context.logger.info("Tool budget reached", {
          toolCallBudget: this.options.toolCallBudget,
          attemptedToolName: decision.toolName,
        });

        const lastCall = toolCalls[toolCalls.length - 1];

        if (lastCall) {
          finalAnswer = await this.answerFromToolResult(context, request, sessionContext, lastCall, streamedFlag);

          await recordStep({
            needsTool: true,
            toolName: decision.toolName,
            toolInput: decision.toolInput ?? request.input,
            outcome: "budget_exceeded",
            durationMs: Date.now() - stepStartedAt,
            finishedAt: new Date().toISOString(),
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
          step: stepNumber,
          toolName: tool.name,
          toolInput,
        });

        finalAnswer = await this.answerFromToolResult(context, request, sessionContext, existingCall, streamedFlag);

        await recordStep({
          needsTool: true,
          toolName: tool.name,
          toolInput,
          outcome: "duplicate_skipped",
          durationMs: Date.now() - stepStartedAt,
          finishedAt: new Date().toISOString(),
        });
        break;
      }

      context.logger.info("Tool execution started", {
        step: stepNumber,
        toolName: tool.name,
        toolInput,
      });

      context.emitStream?.({
        type: "tool_start",
        taskId: request.taskId,
        step: stepNumber,
        toolName: tool.name,
        toolInput,
      });

      const startedAt = new Date().toISOString();

      try {
        const toolOutput = await tool.execute({
          input: toolInput,
        });

        context.logger.info("Tool execution finished", {
          step: stepNumber,
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
          step: stepNumber,
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

        context.emitStream?.({
          type: "tool_end",
          taskId: request.taskId,
          step: stepNumber,
          toolName: tool.name,
          status: "succeeded",
          toolOutput,
        });

        await recordStep({
          needsTool: true,
          toolName: tool.name,
          toolInput,
          outcome: "tool_executed",
          durationMs: Date.now() - stepStartedAt,
          finishedAt: new Date().toISOString(),
        });

        // 单工具任务（eval 基线均为 maxToolCalls=1）：工具成功后直接流式生成回答，跳过第二轮 plan。
        finalAnswer = await this.answerFromToolResult(
          context,
          request,
          sessionContext,
          { toolName: tool.name, input: toolInput, output: toolOutput },
          streamedFlag,
        );
        break;
      } catch (error: unknown) {
        const errorCode = error instanceof AppError ? error.code : "TOOL_ERROR";
        const errorMessage = error instanceof Error ? error.message : String(error);

        context.emitStream?.({
          type: "tool_end",
          taskId: request.taskId,
          step: stepNumber,
          toolName: tool.name,
          status: "failed",
          errorCode,
          errorMessage,
        });

        await context.memory.recordToolCall({
          taskId: request.taskId,
          step: stepNumber,
          toolName: tool.name,
          toolInput,
          status: "failed",
          errorCode,
          errorMessage,
          createdAt: startedAt,
          finishedAt: new Date().toISOString(),
        });

        await recordStep({
          needsTool: true,
          toolName: tool.name,
          toolInput,
          outcome: "tool_failed",
          errorCode,
          errorMessage,
          durationMs: Date.now() - stepStartedAt,
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

      const fallbackStartedAt = Date.now();
      const fallbackCreatedAt = new Date(fallbackStartedAt).toISOString();
      const fallbackStep = toolCalls.length + 1;

      finalAnswer = await this.answerFromToolResult(context, request, sessionContext, lastCall, streamedFlag);

      await context.memory.recordPlannerStep({
        // 循环因 maxSteps 结束且尚无 finalAnswer 时，用最后一次工具结果强行生成回答。
        taskId: request.taskId,
        step: fallbackStep,
        needsTool: false,
        toolName: lastCall.toolName,
        toolInput: lastCall.input,
        outcome: "fallback_answer",
        durationMs: Date.now() - fallbackStartedAt,
        createdAt: fallbackCreatedAt,
        finishedAt: new Date().toISOString(),
      });
    }

    if (context.emitStream && !streamedFlag.value && finalAnswer) {
      // plan() 直接返回 draftAnswer 时 LLM 未走 stream，用切片 fallback。
      await emitTokenStream(context.emitStream, request.taskId, finalAnswer);
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

  private async answerFromToolResult(
    context: AgentContext,
    request: AgentRequest,
    sessionContext: { sessionSummary: string | null; recentHistory: LlmConversationMessage[] },
    toolCall: { toolName: string; input: string; output: string },
    streamedFlag: { value: boolean },
  ): Promise<string> {
    return context.llm.answerWithTool(
      {
        sessionSummary: sessionContext.sessionSummary,
        conversationHistory: sessionContext.recentHistory,
        userInput: request.input,
        toolName: toolCall.toolName,
        toolInput: toolCall.input,
        toolOutput: toolCall.output,
      },
      {
        onToken: createTokenHandler(context.emitStream, request.taskId, streamedFlag),
      },
    );
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
