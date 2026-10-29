import type { RecordPlannerStepInput } from "../memory/memory-store.js";
import { throwIfAborted, isTaskCancellation } from "../runtime/abort-utils.js";
import {
  createTokenHandler,
  emitPlannerDecision,
  emitTokenStream,
} from "../runtime/agent-stream.js";
import { AppError } from "../shared/app-error.js";
import { executeToolWithRetry } from "../tools/tool-retry.js";
import type { Agent, AgentContext, AgentRequest, AgentResponse } from "./base-agent.js";

type LlmConversationMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
};

/**
 * E.12.x：受限专家无法完成时，通知 Supervisor 改派给 general 的内部控制信号。
 * 它只在同一次 `SupervisorAgent.plan()` 内被捕获，不能冒泡到 TaskRunner 变成任务失败。
 */
export class EscalateToGeneralError extends Error {
  constructor() {
    super("Restricted specialist requested escalation to general.");
    this.name = "EscalateToGeneralError";
  }
}

/**
 * PlannerAgent：本项目的 Agent 核心循环（也可被 Supervisor 以工具子集委托）。
 *
 * 常规执行顺序（跨模块）：
 * 1. TaskRunner 调本类 plan；supervisor 模式先由 Supervisor 选专家与工具子集。
 * 2. plan 读取会话上下文 → LlmClient.plan 决定工具或直接回答 → Tool 执行并写 planner_steps / tool_calls。
 * 3. 产出草稿后（E.15）可选 LlmClient.reflect 自检：通过则交稿，拒绝则带着 critique 再 plan。
 * 4. 工具结果交 LlmClient.answerWithTool 组织回答，最后写 messages，由 TaskRunner 收尾 HTTP/SSE。
 * 旁路：受限专家缺 general 工具时抛 EscalateToGeneralError，由 Supervisor 改派；危险 Tool 则先等人工确认。
 *
 * 本文件执行链路：见方法上的 [1]…[5]
 * [1] plan → [2] awaitHumanConfirmation → [3] answerFromToolResult → [4] finalizeDraftWithReflection → [5] buildSessionContext
 */
export class PlannerAgent implements Agent {
  constructor(
    private readonly options: {
      /** 主循环最多迭代几次；对应 env AGENT_MAX_STEPS（每次迭代一次 llm.plan） */
      maxSteps: number;
      /** 成功工具次数上限；对应 env AGENT_TOOL_CALL_BUDGET */
      toolCallBudget: number;
      sessionHistoryMessageLimit: number;
      sessionHistoryCharBudget: number;
      /** E.15：定稿前是否调用 llm.reflect；false = 纯 ReAct */
      reflectionEnabled?: boolean;
      /** E.15：拒绝草稿后最多再规划几次 */
      reflectionMaxRetries?: number;
      /** E.16：幂等工具遇到 NETWORK_ERROR 时的额外重试次数与退避窗口 */
      toolMaxRetries?: number;
      toolRetryBaseDelayMs?: number;
      toolRetryMaxDelayMs?: number;
    },
  ) {}

  /**
   * [1] Agent 核心循环：输入任务与运行上下文，输出最终回答和已执行工具；同时落 planner_steps / tool_calls / messages。
   * supervisor 预占 routed step 时用 stepOffset 避免与专家内部步骤冲突。
   */
  async plan(request: AgentRequest, context: AgentContext): Promise<AgentResponse> {
    // 0. 有 session 时：旧消息 summarize + 最近 N 条原文，供本轮 LLM 上下文
    const sessionContext = request.sessionId
      ? await this.buildSessionContext(request, context)
      : { recentHistory: [] as LlmConversationMessage[], sessionSummary: null as string | null };
    const toolCalls: AgentResponse["toolCalls"] = [];
    let finalAnswer = "";
    const streamedFlag = { value: false }; // answerWithTool 是否已推过 token（SSE 用）
    // E.12：Supervisor 已写 step 1（routed）时 offset=1，避免专家 step 与路由步冲突
    // E.15：reflection 步也占 plannerTrace.step，因此用游标统一分配，不能再用「循环下标 + offset」硬算
    // 例：plan(echo)=1 → reflect=2 → plan(time)=3 → reflect=4；循环 iteration 只到 2，但 step 已到 4
    let stepCursor = context.stepOffset ?? 0;
    const allocateStep = (): number => {
      stepCursor += 1;
      return stepCursor;
    };
    // E.15：上一轮反思 critique；喂给下一轮 llm.plan 的 reflectionFeedback
    let reflectionFeedback: string | null = null;
    let reflectionRetryCount = 0;
    // 未传视为开启（与 env AGENT_REFLECTION 默认 true 一致）；显式 false 才关
    const reflectionEnabled = this.options.reflectionEnabled !== false;
    // 拒绝后最多再 plan 几次；与 enabled 分开：budget_exceeded 路径会传 maxRetries=0 仍审一次
    const reflectionMaxRetries = this.options.reflectionMaxRetries ?? 1;
    // E.12.x：升级后的组合任务若重复已成功工具，下一轮从 LLM 可见工具中排除它。
    // 例：time 已成功却再次被选中 → 后续只让模型看到 write_file 等未排除工具。
    const excludedToolNames = new Set<string>();
    // 连续规划只处理用户显式写出的工具名；按输入顺序强制下一项，避免 “time → write_file” 被模型改成重复 time。
    // 例：`先 time 再 write_file` → ["time", "write_file"]。
    // 未点名工具时是原有自动选型：llm.plan 同时看到当前专家的可用工具与用户意图，自行返回某个 tool_call 或直接回答。
    // 例：`现在几点` → time；`解释 TypeScript` → 不调工具；不会由后端预先指定某个工具。
    const requiredToolNames = context.continuePlanningAfterToolCalls
      ? context.tools
          .map((tool) => ({ name: tool.name, index: request.input.indexOf(tool.name) }))
          .filter((item) => item.index >= 0)
          .sort((left, right) => left.index - right.index)
          .map((item) => item.name)
      : [];

    for (let iteration = 0; iteration < this.options.maxSteps; iteration += 1) {
      // E.8：每步开始前检查取消/超时，避免 abort 后继续打 LLM
      throwIfAborted(context.signal);

      const stepNumber = allocateStep();
      const stepStartedAt = Date.now();
      const stepCreatedAt = new Date(stepStartedAt).toISOString();

      // E.12.x：用户明确点名的工具若只存在于 general，不让受限专家靠模型猜“该升级”。
      // 合法例：files 收到 `time` + `write_file`，time 不在 files 但在 general → 直接 escalated；
      // 非法例：imaginary_tool 全局不存在 → 不升级，仍交给下方 Planner/TOOL_ERROR 正常处理。
      const requestedGeneralOnlyToolName = context.allowEscalationToGeneral
        ? context.generalToolNames?.find(
            (toolName) =>
              request.input.includes(toolName) && !context.tools.some((tool) => tool.name === toolName),
          )
        : undefined;

      // 当前专家不能执行用户点名的 general 专属工具；先落 `escalated/general`，再抛内部信号让 Supervisor 记二次 `routed/general`。
      // 例：files 收到 `time` + `write_file` 时，time 触发此分支；不能在 files 内伪造 time 的执行结果。
      if (requestedGeneralOnlyToolName) {
        context.logger.info("Planner escalated explicit general-only tool before planning", {
          step: stepNumber,
          requestedToolName: requestedGeneralOnlyToolName,
        });
        await context.memory.recordPlannerStep({
          taskId: request.taskId,
          step: stepNumber,
          needsTool: false,
          toolName: "general",
          toolInput: null,
          outcome: "escalated",
          durationMs: Date.now() - stepStartedAt,
          createdAt: stepCreatedAt,
          finishedAt: new Date().toISOString(),
        });
        throw new EscalateToGeneralError();
      }

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
        // docs/files 才能看见虚拟 escalate_to_general；general 不可升级，避免路由循环。
        allowEscalationToGeneral: context.allowEscalationToGeneral,
        // 仅升级后的 general 连续执行剩余工具；普通专家保持原有单工具结束策略。
        continuePlanningAfterToolCalls: context.continuePlanningAfterToolCalls,
        excludedToolNames: [...excludedToolNames],
        // 已成功工具从显式序列移除；剩余唯一项会在 LLM 客户端被 function calling 强制选中。
        requiredToolNames: requiredToolNames.filter(
          (toolName) => !toolCalls.some((call) => call.toolName === toolName),
        ),
        // E.15：上一轮反思 critique；无则 null，模型看到 Reflection feedback: None.
        reflectionFeedback,
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

      /**
       * B. 升级不是工具调用：记入 plannerTrace 后抛内部信号，交给 Supervisor 固定改派 general。
       * 显式例：模型选虚拟 escalate_to_general；隐式例：files 选 time 而 time 仅在 general 中存在。
       * 两种形态都不能写入 tool_calls，因为此时尚未执行真实业务工具。
       */
      const escalateToGeneral = async (): Promise<never> => {
        await recordStep({
          needsTool: false,
          toolName: "general",
          toolInput: null,
          outcome: "escalated",
          durationMs: Date.now() - stepStartedAt,
          finishedAt: new Date().toISOString(),
        });
        throw new EscalateToGeneralError();
      };

      if (decision.escalateToGeneral) {
        await escalateToGeneral();
      }

      // C. 不需要工具 → outcome: direct_answer
      if (!decision.needsTool || !decision.toolName) {
        // 开启 Reflection 时先不 stream：草稿可能被拒绝；通过后再由文末 emitTokenStream 推送
        const streamDraft = !reflectionEnabled;
        // 若本轮已调过工具，用 answerWithTool；否则用 plan 返回的 draftAnswer
        const draftAnswer =
          toolCalls.length > 0
            ? await this.answerFromToolResult(
                context,
                request,
                sessionContext,
                toolCalls[toolCalls.length - 1]!,
                streamedFlag,
                streamDraft,
              )
            : decision.draftAnswer;

        await recordStep({
          needsTool: decision.needsTool,
          toolName: decision.toolName ?? null,
          toolInput: null,
          outcome: "direct_answer",
          durationMs: Date.now() - stepStartedAt,
          finishedAt: new Date().toISOString(),
        });

        const accepted = await this.finalizeDraftWithReflection({
          context,
          request,
          draftAnswer,
          toolCalls,
          allocateStep,
          reflectionEnabled,
          reflectionMaxRetries,
          reflectionRetryCount,
          setReflectionRetryCount: (value) => {
            reflectionRetryCount = value;
          },
          setReflectionFeedback: (value) => {
            reflectionFeedback = value;
          },
        });

        if (accepted) {
          finalAnswer = draftAnswer;
          break;
        }

        // reflection_retry：带着 critique 进入下一轮 plan
        continue;
      }

      // D. 工具预算用尽 → outcome: budget_exceeded
      if (toolCalls.length >= this.options.toolCallBudget) {
        context.logger.info("Tool budget reached", {
          toolCallBudget: this.options.toolCallBudget,
          attemptedToolName: decision.toolName,
        });

        const lastCall = toolCalls[toolCalls.length - 1];

        if (lastCall) {
          const draftAnswer = await this.answerFromToolResult(
            context,
            request,
            sessionContext,
            lastCall,
            streamedFlag,
            !reflectionEnabled,
          );

          await recordStep({
            needsTool: true,
            toolName: decision.toolName,
            toolInput: decision.toolInput ?? request.input,
            outcome: "budget_exceeded",
            durationMs: Date.now() - stepStartedAt,
            finishedAt: new Date().toISOString(),
          });

          // 预算已尽：即使反思想重试也不再开新工具；仍跑一次 reflect 记 outcome，然后强制交稿
          await this.finalizeDraftWithReflection({
            context,
            request,
            draftAnswer,
            toolCalls,
            allocateStep,
            reflectionEnabled,
            reflectionMaxRetries: 0,
            reflectionRetryCount,
            setReflectionRetryCount: (value) => {
              reflectionRetryCount = value;
            },
            setReflectionFeedback: (value) => {
              reflectionFeedback = value;
            },
          });
          finalAnswer = draftAnswer;
          break;
        }
      }

      // E. 解析工具名。受限专家若选了 general 独有工具，后端自动升级，不依赖模型记住虚拟 function。
      const tool = context.tools.find((item) => item.name === decision.toolName);

      if (!tool) {
        const isKnownGeneralTool =
          context.allowEscalationToGeneral &&
          context.generalToolNames?.includes(decision.toolName) === true;

        // 合法例：files 工具箱无 time，但 general 有 → 自动升级；非法例：imaginary_tool 全局不存在 → 下方 TOOL_ERROR。
        if (isKnownGeneralTool) {
          context.logger.info("Planner escalated unavailable specialist tool to general", {
            step: stepNumber,
            requestedToolName: decision.toolName,
          });
          await escalateToGeneral();
        }

        throw new AppError("TOOL_ERROR", `Requested tool "${decision.toolName}" is not registered.`);
      }

      const toolInput = decision.toolInput ?? request.input;
      const existingCall = toolCalls.find((call) => call.toolName === tool.name && call.input === toolInput);

      // F. 重复工具调用 → outcome: duplicate_skipped
      if (existingCall) {
        context.logger.info("Duplicate tool call skipped", {
          step: stepNumber,
          toolName: tool.name,
          toolInput,
        });

        await recordStep({
          needsTool: true,
          toolName: tool.name,
          toolInput,
          outcome: "duplicate_skipped",
          durationMs: Date.now() - stepStartedAt,
          finishedAt: new Date().toISOString(),
        });

        // 升级后的组合任务不能因第一次重复就把“尚未写文件”等后续动作吞掉。
        // 合法例：time → 又选 time → 排除 time 后重规划 write_file；普通任务仍保持原有“复用结果后回答”。
        if (context.continuePlanningAfterToolCalls) {
          excludedToolNames.add(tool.name);
          continue;
        }

        const draftAnswer = await this.answerFromToolResult(
          context,
          request,
          sessionContext,
          existingCall,
          streamedFlag,
          !reflectionEnabled,
        );
        const accepted = await this.finalizeDraftWithReflection({
          context,
          request,
          draftAnswer,
          toolCalls,
          allocateStep,
          reflectionEnabled,
          reflectionMaxRetries,
          reflectionRetryCount,
          setReflectionRetryCount: (value) => {
            reflectionRetryCount = value;
          },
          setReflectionFeedback: (value) => {
            reflectionFeedback = value;
          },
        });
        if (accepted) {
          finalAnswer = draftAnswer;
          break;
        }
        continue;
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
        // G. 执行工具 → outcome: tool_executed（成功路径）
        const toolOutput = await executeToolWithRetry(
          tool,
          {
            input: toolInput,
            // E.8：把任务 AbortSignal 传给工具，wait 等可中断工具才能中途停下
            signal: context.signal,
          },
          {
            maxRetries: this.options.toolMaxRetries ?? 2,
            baseDelayMs: this.options.toolRetryBaseDelayMs ?? 100,
            maxDelayMs: this.options.toolRetryMaxDelayMs ?? 2000,
            logger: context.logger,
          },
        );

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

        // 升级后的 general 要能完成跨能力任务。
        // 例：先 time 得到时间，再下一轮选 write_file；普通专家仍沿用“一次工具后回答”。
        if (context.continuePlanningAfterToolCalls) {
          continue;
        }

        // 单工具任务（eval 基线多为 maxToolCalls=1）：工具成功后生成草稿；E.15 可自检后再交稿。
        const draftAnswer = await this.answerFromToolResult(
          context,
          request,
          sessionContext,
          { toolName: tool.name, input: toolInput, output: toolOutput },
          streamedFlag,
          !reflectionEnabled,
        );
        const accepted = await this.finalizeDraftWithReflection({
          context,
          request,
          draftAnswer,
          toolCalls,
          allocateStep,
          reflectionEnabled,
          reflectionMaxRetries,
          reflectionRetryCount,
          setReflectionRetryCount: (value) => {
            reflectionRetryCount = value;
          },
          setReflectionFeedback: (value) => {
            reflectionFeedback = value;
          },
        });
        if (accepted) {
          finalAnswer = draftAnswer;
          break;
        }
        continue;
      } catch (error: unknown) {
        // 取消/超时不是工具失败：原样抛出，由 TaskRunner 落 cancelled
        if (error instanceof AppError && isTaskCancellation(error)) {
          throw error;
        }

        // H. 工具失败 → outcome: tool_failed，向上抛出让 TaskRunner 标 failed
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

    // I. 循环结束仍无回答 → outcome: fallback_answer（maxSteps 兜底）
    if (!finalAnswer) {
      const lastCall = toolCalls[toolCalls.length - 1];

      if (!lastCall) {
        throw new AppError("INTERNAL_ERROR", "Agent ended without a final answer or tool call.");
      }

      const fallbackStartedAt = Date.now();
      const fallbackCreatedAt = new Date(fallbackStartedAt).toISOString();
      // 与循环内一致：用游标分配 step，避免与 Supervisor routed / reflection 步撞号
      const fallbackStep = allocateStep();

      const draftAnswer = await this.answerFromToolResult(
        context,
        request,
        sessionContext,
        lastCall,
        streamedFlag,
        !reflectionEnabled,
      );

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

      // maxSteps 已尽：反思预算强制为 0，只记 reflection_passed/retry 后交稿，不再开新轮
      await this.finalizeDraftWithReflection({
        context,
        request,
        draftAnswer,
        toolCalls,
        allocateStep,
        reflectionEnabled,
        reflectionMaxRetries: 0,
        reflectionRetryCount,
        setReflectionRetryCount: (value) => {
          reflectionRetryCount = value;
        },
        setReflectionFeedback: (value) => {
          reflectionFeedback = value;
        },
      });
      finalAnswer = draftAnswer;
    }

    // J. 未走真流式时，把 finalAnswer 切片推 token（仅 /agent/stream）
    if (context.emitStream && !streamedFlag.value && finalAnswer) {
      await emitTokenStream(context.emitStream, request.taskId, finalAnswer);
    }

    // K. 写 assistant 消息，返回给 TaskRunner → HTTP result.summary
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
   * [2] E.10：requiresConfirmation 工具在 execute 前挂起。
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

  /**
   * [3] 将一个工具结果连同会话上下文交给 LLM，返回可直接写入 assistant message 的自然语言答复。
   * 输入例：time 的 ISO 时间；输出例：`现在是 10:00`，流式时同步转发 SSE token。
   * @param allowStream false 时不推 token（E.15 草稿可能被反思拒绝，避免先流式泄露错误答复）
   */
  private async answerFromToolResult(
    context: AgentContext,
    request: AgentRequest,
    sessionContext: { sessionSummary: string | null; recentHistory: LlmConversationMessage[] },
    toolCall: { toolName: string; input: string; output: string },
    streamedFlag: { value: boolean },
    allowStream = true,
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
        // 开反思：allowStream=false，草稿可能被拒，避免 SSE 先推错误答复；
        // 通过后由 plan() 文末 emitTokenStream 再推最终稿（streamedFlag 仍为 false）。
        // 关反思：与改前一致，边生成边推 token。
        onToken: allowStream
          ? createTokenHandler(context.emitStream, request.taskId, streamedFlag)
          : undefined,
      },
    );
  }

  /**
   * [4] E.15：对草稿做 Reflection 自检。
   * 返回 true = 可交稿（reflection_passed 或未开启反思）；false = reflection_retry，调用方 continue 再 plan。
   * 例：用户要时间、草稿只复述 echo → false + critique「改用 time」。
   */
  private async finalizeDraftWithReflection(input: {
    context: AgentContext;
    request: AgentRequest;
    draftAnswer: string;
    toolCalls: AgentResponse["toolCalls"];
    allocateStep: () => number;
    reflectionEnabled: boolean;
    reflectionMaxRetries: number;
    reflectionRetryCount: number;
    setReflectionRetryCount: (value: number) => void;
    setReflectionFeedback: (value: string | null) => void;
  }): Promise<boolean> {
    const {
      context,
      request,
      draftAnswer,
      toolCalls,
      allocateStep,
      reflectionEnabled,
      reflectionMaxRetries,
      reflectionRetryCount,
      setReflectionRetryCount,
      setReflectionFeedback,
    } = input;

    // 形态 0：AGENT_REFLECTION=false → 不调 llm.reflect，与改前 ReAct 一致直接交稿
    // 注意：这与「enabled=true 且 maxRetries=0」不同——后者仍会审一次，只是拒绝也不再 plan
    if (!reflectionEnabled) {
      setReflectionFeedback(null);
      return true;
    }

    throwIfAborted(context.signal);

    // reflection 步单独占 plannerTrace.step（与 tool_executed / direct_answer 并列），用游标分配
    const stepNumber = allocateStep();
    const stepStartedAt = Date.now();
    const stepCreatedAt = new Date(stepStartedAt).toISOString();

    context.logger.info("Reflection started", {
      step: stepNumber,
      draftPreview: draftAnswer.slice(0, 240),
      toolCallCount: toolCalls.length,
      reflectionRetryCount,
    });

    // 调评审 LLM；toolCalls 是本任务已成功工具证据（与草稿对照，抓「嘴上说调了 time 实际只有 echo」）
    const verdict = await context.llm.reflect({
      userInput: request.input,
      draftAnswer,
      toolCalls: toolCalls.map((call) => ({
        toolName: call.toolName,
        toolInput: call.input,
        toolOutput: call.output,
      })),
      signal: context.signal,
      onLlmCall: (event) => context.metrics?.recordLlmCall(event),
    });

    throwIfAborted(context.signal);

    // 形态 A：接受；或重试预算已用尽 → 强制交稿，避免死循环
    // 合法例：accepted=true → reflection_passed；
    // 合法例：budget_exceeded/fallback 传入 maxRetries=0 且仍 revise → forceAccept，仍记 reflection_passed
    const forceAccept = !verdict.accepted && reflectionRetryCount >= reflectionMaxRetries;
    if (verdict.accepted || forceAccept) {
      await context.memory.recordPlannerStep({
        taskId: request.taskId,
        step: stepNumber,
        needsTool: false,
        toolName: null,
        toolInput: null,
        outcome: "reflection_passed",
        // 强制交稿时用专用码，方便 replay 区分「真通过」vs「预算用尽硬交」
        errorCode: forceAccept ? "REFLECTION_BUDGET_EXCEEDED" : null,
        errorMessage: forceAccept
          ? `Accepted after reflection budget exhausted. Last critique: ${verdict.critique}`
          : verdict.critique,
        durationMs: Date.now() - stepStartedAt,
        createdAt: stepCreatedAt,
        finishedAt: new Date().toISOString(),
      });
      setReflectionFeedback(null);
      context.logger.info("Reflection accepted draft", {
        step: stepNumber,
        forced: forceAccept,
        critiquePreview: verdict.critique.slice(0, 240),
      });
      return true;
    }

    // 形态 B：拒绝 → 记 reflection_retry；errorMessage=critique，下一轮 plan.reflectionFeedback 同源
    await context.memory.recordPlannerStep({
      taskId: request.taskId,
      step: stepNumber,
      needsTool: false,
      toolName: null,
      toolInput: null,
      outcome: "reflection_retry",
      errorCode: null,
      errorMessage: verdict.critique,
      durationMs: Date.now() - stepStartedAt,
      createdAt: stepCreatedAt,
      finishedAt: new Date().toISOString(),
    });
    setReflectionRetryCount(reflectionRetryCount + 1);
    setReflectionFeedback(verdict.critique);
    context.logger.info("Reflection rejected draft; will replan", {
      step: stepNumber,
      critiquePreview: verdict.critique.slice(0, 240),
      nextRetryCount: reflectionRetryCount + 1,
    });
    return false;
  }

  /**
   * [5] 组装喂给模型的会话上下文：旧内容走持久化摘要，最近内容保留原文。
   * 示例：20 条历史且窗口为 8 → 早 12 条进入 sessions.summary，后 8 条原样传给 LLM。
   */
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
