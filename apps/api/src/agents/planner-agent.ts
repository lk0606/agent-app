import type { RecordPlannerStepInput } from "../memory/memory-store.js";
import { throwIfAborted, isTaskCancellation } from "../runtime/abort-utils.js";
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

/**
 * PlannerAgent：本项目的 Agent 核心循环。
 *
 * 每一轮 step：
 *   llm.plan() → 要不要工具 → 执行 Tool → recordPlannerStep / recordToolCall
 *   → 工具足够时 llm.answerWithTool() 流式生成最终回答
 *
 * 有 sessionId 时先 buildSessionContext()：旧消息压成 summary，最近 N 条保留原文。
 */
export class PlannerAgent implements Agent {
  constructor(
    private readonly options: {
      maxSteps: number;
      toolCallBudget: number;
      sessionHistoryMessageLimit: number;
      sessionHistoryCharBudget: number;
    },
  ) {}

  // Agent 核心循环：每轮 llm.plan → 可选工具 → 生成 finalAnswer；落库 planner_steps / tool_calls / messages
  async plan(request: AgentRequest, context: AgentContext): Promise<AgentResponse> {
    // 0. 有 session 时：旧消息 summarize + 最近 N 条原文，供本轮 LLM 上下文
    const sessionContext = request.sessionId
      ? await this.buildSessionContext(request, context)
      : { recentHistory: [] as LlmConversationMessage[], sessionSummary: null as string | null };
    const toolCalls: AgentResponse["toolCalls"] = [];
    let finalAnswer = "";
    const streamedFlag = { value: false }; // answerWithTool 是否已推过 token（SSE 用）

    for (let step = 0; step < this.options.maxSteps; step += 1) {
      // E.8：每步开始前检查取消/超时，避免 abort 后继续打 LLM
      throwIfAborted(context.signal);

      const stepNumber = step + 1;
      const stepStartedAt = Date.now();
      const stepCreatedAt = new Date(stepStartedAt).toISOString();

      // A. 问 LLM：本轮要不要工具、调哪个
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
        signal: context.signal,
        // E.9：把本次 plan 的 token/耗时报给 TaskMetricsCollector
        onLlmCall: (event) => context.metrics?.recordLlmCall(event),
      });

      throwIfAborted(context.signal);

      emitPlannerDecision(context.emitStream, request.taskId, stepNumber, decision);

      context.logger.info("Planner step decided", {
        step: stepNumber,
        needsTool: decision.needsTool,
        toolName: decision.toolName,
      });

      // 写 planner_steps（规划决策链 → GET /tasks plannerTrace）
      const recordStep = async (input: Omit<RecordPlannerStepInput, "taskId" | "step" | "createdAt">) => {
        await context.memory.recordPlannerStep({
          taskId: request.taskId,
          step: stepNumber,
          createdAt: stepCreatedAt,
          ...input,
        });
      };

      // B. 不需要工具 → outcome: direct_answer
      if (!decision.needsTool || !decision.toolName) {
        // 若本轮已调过工具，用 answerWithTool；否则用 plan 返回的 draftAnswer
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

      // C. 工具预算用尽 → outcome: budget_exceeded
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

      // D. 解析工具名，找不到则抛 TOOL_ERROR
      const tool = context.tools.find((item) => item.name === decision.toolName);

      if (!tool) {
        throw new AppError("TOOL_ERROR", `Requested tool "${decision.toolName}" is not registered.`);
      }

      const toolInput = decision.toolInput ?? request.input;
      const existingCall = toolCalls.find((call) => call.toolName === tool.name && call.input === toolInput);

      // E. 重复工具调用 → outcome: duplicate_skipped
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

      throwIfAborted(context.signal);

      // E.10：危险工具（如 write_file）先挂起等人；批准后才 tool_start / execute
      if (tool.requiresConfirmation) {
        const rejected = await this.awaitHumanConfirmation({
          context,
          request,
          stepNumber,
          toolName: tool.name,
          toolInput,
          stepStartedAt,
          recordStep,
          toolCalls,
          sessionContext,
          streamedFlag,
        });

        // 非 null = 人已拒绝并生成了 finalAnswer；跳过 execute，结束本轮循环
        if (rejected) {
          finalAnswer = rejected;
          break;
        }
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

      throwIfAborted(context.signal);

      const startedAt = new Date().toISOString();

      try {
        // F. 执行工具 → outcome: tool_executed（成功路径）
        const toolOutput = await tool.execute({
          input: toolInput,
          // E.8：把任务 AbortSignal 传给工具，wait 等可中断工具才能中途停下
          signal: context.signal,
        });

        throwIfAborted(context.signal);

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

        // 写 tool_calls（实际执行记录 → GET /tasks toolCalls）
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
        // 取消/超时不是工具失败：原样抛出，由 TaskRunner 落 cancelled
        if (error instanceof AppError && isTaskCancellation(error)) {
          throw error;
        }

        // G. 工具失败 → outcome: tool_failed，向上抛出让 TaskRunner 标 failed
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

    // H. 循环结束仍无回答 → outcome: fallback_answer（maxSteps 兜底）
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

    // I. 未走真流式时，把 finalAnswer 切片推 token（仅 /agent/stream）
    if (context.emitStream && !streamedFlag.value && finalAnswer) {
      await emitTokenStream(context.emitStream, request.taskId, finalAnswer);
    }

    // J. 写 assistant 消息，返回给 TaskRunner → HTTP result.summary
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

  /**
   * E.10：requiresConfirmation 工具在 execute 前挂起。
   * 返回值约定：
   * - `null` → 人已 approve，调用方继续 tool_start / execute
   * - `string` → 人已 reject，该字符串是最终回答，调用方应 break（勿再 execute）
   *
   * 本方法内链路：[1] 发 SSE/落 awaiting → [2] wait → [3a] approve 返回 null / [3b] reject 回流
   */
  private async awaitHumanConfirmation(input: {
    context: AgentContext;
    request: AgentRequest;
    stepNumber: number;
    toolName: string;
    toolInput: string;
    stepStartedAt: number;
    recordStep: (input: Omit<RecordPlannerStepInput, "taskId" | "step" | "createdAt">) => Promise<void>;
    toolCalls: AgentResponse["toolCalls"];
    sessionContext: { sessionSummary: string | null; recentHistory: LlmConversationMessage[] };
    streamedFlag: { value: boolean };
  }): Promise<string | null> {
    const {
      context,
      request,
      stepNumber,
      toolName,
      toolInput,
      stepStartedAt,
      recordStep,
      toolCalls,
      sessionContext,
      streamedFlag,
    } = input;

    // create-agent-runtime 必须注入 confirmations；缺了说明装配错误，不是业务失败
    if (!context.confirmations) {
      throw new AppError(
        "INTERNAL_ERROR",
        `Tool "${toolName}" requires confirmation but ConfirmationRegistry was not injected.`,
      );
    }

    context.logger.info("Awaiting human confirmation", {
      step: stepNumber,
      toolName,
      toolInputPreview: toolInput.slice(0, 240),
      autoApprove: Boolean(context.confirmationAutoApprove),
    });

    // [1] 手测窗口：此时尚无 tool_start；客户端据此 POST confirm
    context.emitStream?.({
      type: "awaiting_confirmation",
      taskId: request.taskId,
      step: stepNumber,
      toolName,
      toolInput,
    });

    // autoApprove 时跳过 DB 闪烁 awaiting（evals 瞬间通过，避免观测到中间态）
    if (!context.confirmationAutoApprove) {
      await context.memory.updateTask(request.taskId, {
        status: "awaiting_confirmation",
      });
    }

    // [2] 挂起；cancel/超时经 signal abort 会在此抛 CANCELLED
    const decision = await context.confirmations.wait(
      request.taskId,
      { step: stepNumber, toolName, toolInput },
      {
        signal: context.signal,
        autoApprove: context.confirmationAutoApprove,
      },
    );

    throwIfAborted(context.signal);

    // [3a] 批准 → 回到 running，返回 null，外层才 emit tool_start / execute
    if (decision === "approve") {
      await context.memory.updateTask(request.taskId, {
        status: "running",
      });
      context.logger.info("Human approved tool execution", { step: stepNumber, toolName });
      return null;
    }

    // [3b] 拒绝 → 不写盘；合成 tool 输出回流 LLM；任务最终仍可 succeeded
    // 例：tool_calls.status=skipped, errorCode=HUMAN_REJECTED；plannerTrace.outcome=human_rejected
    const rejectionOutput =
      "HUMAN_REJECTED: The user rejected this tool execution. Do not claim the write succeeded.";
    const startedAt = new Date().toISOString();
    const finishedAt = new Date().toISOString();

    context.logger.info("Human rejected tool execution", { step: stepNumber, toolName });

    await context.memory.append(request.taskId, {
      role: "tool",
      content: `[${toolName}] ${rejectionOutput}`,
      timestamp: finishedAt,
    });

    await context.memory.recordToolCall({
      taskId: request.taskId,
      step: stepNumber,
      toolName,
      toolInput,
      toolOutput: rejectionOutput,
      status: "skipped",
      errorCode: "HUMAN_REJECTED",
      errorMessage: "User rejected the tool execution.",
      createdAt: startedAt,
      finishedAt,
    });

    toolCalls.push({
      toolName,
      input: toolInput,
      output: rejectionOutput,
    });

    // SSE tool_end 用 failed 表示「未执行成功」；DB 用 skipped 区分业务失败
    context.emitStream?.({
      type: "tool_end",
      taskId: request.taskId,
      step: stepNumber,
      toolName,
      status: "failed",
      errorCode: "HUMAN_REJECTED",
      errorMessage: "User rejected the tool execution.",
      toolOutput: rejectionOutput,
    });

    await recordStep({
      needsTool: true,
      toolName,
      toolInput,
      outcome: "human_rejected",
      errorCode: "HUMAN_REJECTED",
      errorMessage: "User rejected the tool execution.",
      durationMs: Date.now() - stepStartedAt,
      finishedAt,
    });

    // 回答阶段仍算 running，避免 GET 一直停在 awaiting_confirmation
    await context.memory.updateTask(request.taskId, {
      status: "running",
    });

    return this.answerFromToolResult(
      context,
      request,
      sessionContext,
      { toolName, input: toolInput, output: rejectionOutput },
      streamedFlag,
    );
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
        signal: context.signal,
        onLlmCall: (event) => context.metrics?.recordLlmCall(event),
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
      signal: context.signal,
      onLlmCall: (event) => context.metrics?.recordLlmCall(event),
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
