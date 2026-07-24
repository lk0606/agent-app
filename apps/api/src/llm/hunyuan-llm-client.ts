/**
 * 混元（TokenHub OpenAI 兼容接口）的 LlmClient 实现。
 * model / baseURL 来自 env；旧 api.hunyuan.cloud.tencent.com 的 Key 不能用于 TokenHub。
 *
 * E.8.5：create(body, { signal }) —— signal 在第二参数 RequestOptions，不在 body。
 */
import OpenAI from "openai";

import { AppError } from "../shared/app-error.js";
import { rethrowIfLlmAborted, throwIfAborted } from "../runtime/abort-utils.js";
import type { AnswerRequest, LlmClient, LlmStreamOptions, PlanRequest, PlannerDecision, SessionSummaryRequest } from "./llm-client.js";

export class HunyuanLlmClient implements LlmClient {
  private readonly client: OpenAI;

  constructor(private readonly options: { apiKey: string; model: string; baseURL: string }) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
  }

  /**
   * 第一次 LLM 调用：function calling 决定要不要工具。
   * 返回 PlannerDecision 给 PlannerAgent.plan() 的 A 步，不执行工具本身。
   */
  async plan(input: PlanRequest): Promise<PlannerDecision> {
    try {
      // 1. 调混元 chat.completions：system 规则 + user 上下文 + tools 定义
      const completion = await this.client.chat.completions.create({
        model: this.options.model,
        messages: [
          {
            role: "system",
            // 规划专用 system prompt：何时该调 time / http_fetch / read_file / list_dir / search_docs
            content: [
              "You are a minimal Node agent planner.",
              "Use a tool only when it materially improves accuracy.",
              "If the user asks for current date or time, call the time tool.",
              "If the user asks to open, read, summarize, or inspect a URL, call the http_fetch tool.",
              "If the user asks to read a local text file or project document, call the read_file tool with a relative sandbox path.",
              // 工具名须与 create-agent-runtime 注册的 name 一致，否则模型看不到 function
              "If the user asks to list, browse, or enumerate files in the sandbox directory, call the list_dir tool with a relative path or empty input for the root.",
              "If the user asks to search, find, or look up information across sandbox documents without a specific file path, call the search_docs tool with the query.",
              "If the user explicitly asks to wait, sleep, pause, or delay for N seconds, you MUST call the wait tool with that number of seconds. Do not claim wait is unavailable when it is listed in tools.",
              "If previous tool results are already sufficient, answer directly instead of calling the same tool repeatedly.",
            ].join(" "),
          },
          {
            role: "user",
            // session 摘要 + 最近对话 + 本轮 input + 工具列表 + 本轮已执行工具结果
            content: this.buildPlannerInput(input),
          },
        ],
        // 2. 把注册工具转成 OpenAI function schema（统一参数 { input: string }）
        tools: input.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: "object",
              properties: {
                input: {
                  type: "string",
                  description: "The input passed to the tool.",
                },
              },
              required: ["input"],
              additionalProperties: false,
            },
          },
        })),
        tool_choice: "auto",
      }, { signal: input.signal });

      // 3. 解析模型回复：有 tool_calls → 要工具；否则 → 直接回答
      const message = completion.choices[0]?.message;
      const toolCall = message?.tool_calls?.[0];

      // 4a. 模型选了 function → needsTool=true，交给 PlannerAgent 去 execute
      if (toolCall?.type === "function") {
        const parsedArgs = this.parseToolArguments(toolCall.function.arguments);

        return {
          needsTool: true,
          toolName: toolCall.function.name,
          toolInput: parsedArgs.input ?? input.userInput,
          draftAnswer: "I will use a tool before answering.",
        };
      }

      // 4b. 无 tool_call → needsTool=false，draftAnswer 即最终回答（或后续 answerWithTool 的输入）
      return {
        needsTool: false,
        toolName: null,
        toolInput: null,
        draftAnswer: this.readMessageContent(message?.content),
      };
    } catch (error: unknown) {
      rethrowIfLlmAborted(error);
      throw new AppError("LLM_ERROR", "Hunyuan planning request failed.", { cause: stringifyError(error) });
    }
  }

  // 工具执行后再让模型组织自然语言；stream: true 时通过 onToken 逐 delta 推送。
  async answerWithTool(input: AnswerRequest, options?: LlmStreamOptions): Promise<string> {
    try {
      const messages = [
        {
          role: "system" as const,
          content: [
            "You are a helpful Node agent.",
            "Use the tool result to answer naturally and directly.",
            "Do not mention internal planning unless the user asks.",
          ].join(" "),
        },
        {
          role: "user" as const,
          content: [
            this.buildConversationHistory(input.conversationHistory, input.sessionSummary),
            `User input: ${input.userInput}`,
            `Tool used: ${input.toolName}`,
            `Tool input: ${input.toolInput}`,
            `Tool output:\n${input.toolOutput}`,
          ].join("\n\n"),
        },
      ];

      if (options?.onToken) {
        const stream = await this.client.chat.completions.create(
          {
            model: this.options.model,
            messages,
            stream: true,
          },
          { signal: input.signal },
        );

        let answer = "";

        for await (const chunk of stream) {
          // stream 迭代中途协作退出；SDK 在 signal abort 时也会抛，catch 里 rethrowIfLlmAborted
          throwIfAborted(input.signal);

          const delta = chunk.choices[0]?.delta?.content;

          if (typeof delta === "string" && delta.length > 0) {
            answer += delta;
            options.onToken(delta);
          }
        }

        return answer.length > 0 ? answer : "The model returned an empty response.";
      }

      const completion = await this.client.chat.completions.create(
        {
          model: this.options.model,
          messages,
        },
        { signal: input.signal },
      );

      const message = completion.choices[0]?.message;
      return this.readMessageContent(message?.content);
    } catch (error: unknown) {
      rethrowIfLlmAborted(error);
      throw new AppError("LLM_ERROR", "Hunyuan answer generation failed.", { cause: stringifyError(error) });
    }
  }

  // 将旧会话压缩成稳定摘要，后续请求可复用，降低长会话的 token 和延迟成本。
  async summarizeSession(input: SessionSummaryRequest): Promise<string> {
    try {
      const completion = await this.client.chat.completions.create(
        {
          model: this.options.model,
          messages: [
            {
              role: "system",
              content: [
                "You summarize earlier conversation history for a Node agent.",
                "If an existing summary is provided, merge the new messages into it.",
                "Keep only stable user facts, prior decisions, and important tool findings.",
                "Be concise. Prefer 3 to 6 short bullet-like lines in plain text.",
                "Omit chit-chat and low-value repetition.",
              ].join(" "),
            },
            {
              role: "user",
              // existingSummary 是已压缩的旧历史，后面的 messages 只放新增旧消息，控制摘要调用成本。
              content: [
                `Current user input: ${input.currentUserInput}`,
                `Existing session summary:\n${input.existingSummary?.trim() || "No existing summary."}`,
                "Earlier session history to summarize:",
                input.messages.map((item, index) => `[${index + 1}] ${item.role}: ${item.content}`).join("\n"),
              ].join("\n\n"),
            },
          ],
        },
        { signal: input.signal },
      );

      const message = completion.choices[0]?.message;
      return this.readMessageContent(message?.content);
    } catch (error: unknown) {
      rethrowIfLlmAborted(error);
      throw new AppError("LLM_ERROR", "Hunyuan session summarization failed.", { cause: stringifyError(error) });
    }
  }

  // Function calling 的 arguments 是字符串，解析失败时回退到空对象让上层用默认输入兜底。
  private parseToolArguments(argumentsText: string): { input?: string } {
    try {
      const parsed = JSON.parse(argumentsText) as { input?: unknown };
      return typeof parsed.input === "string" ? { input: parsed.input } : {};
    } catch {
      return {};
    }
  }

  // 兼容普通文本和部分兼容接口返回的 content parts。
  private readMessageContent(content: string | Array<{ type?: string; text?: string }> | null | undefined): string {
    if (typeof content === "string" && content.length > 0) {
      return content;
    }

    if (Array.isArray(content)) {
      const textParts = content
        .flatMap((item) => (typeof item.text === "string" && item.text.length > 0 ? [item.text] : []))
        .join("\n");

      if (textParts.length > 0) {
        return textParts;
      }
    }

    return "The model returned an empty response.";
  }

  // 把结构化规划输入整理成单段 prompt，便于兼容混元的 OpenAI chat completions 接口。
  private buildPlannerInput(input: PlanRequest): string {
    const tools = input.tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
    // previousToolCalls 是本次任务内已经执行过的工具结果，帮助模型避免重复调用同一个工具。
    const history =
      input.previousToolCalls.length === 0
        ? "No previous tool results."
        : input.previousToolCalls
            .map(
              (call, index) =>
                `Step ${index + 1}\nTool: ${call.toolName}\nInput: ${call.toolInput}\nOutput:\n${call.toolOutput}`,
            )
            .join("\n\n");

    return [
      this.buildConversationHistory(input.conversationHistory, input.sessionSummary),
      `User input:\n${input.userInput}`,
      `Available tools:\n${tools}`,
      `Previous tool results:\n${history}`,
    ].join("\n\n");
  }

  // 最终传给模型的是“较早摘要 + 最近原文”，两者缺一时也保持固定格式。
  private buildConversationHistory(
    history: PlanRequest["conversationHistory"] | AnswerRequest["conversationHistory"],
    sessionSummary?: string | null,
  ): string {
    const sections: string[] = [];

    if (sessionSummary && sessionSummary.trim().length > 0) {
      sections.push(`Earlier session summary:\n${sessionSummary}`);
    }

    if (history.length === 0) {
      // 固定输出这个段落，让 planner/answer prompt 结构稳定，减少模型误判“缺了历史字段”。
      sections.push("Conversation history:\nNo recent session messages.");
      return sections.join("\n\n");
    }

    sections.push([
      "Conversation history:",
      history
        .map((item, index) => `[${index + 1}] ${item.role}: ${item.content}`)
        .join("\n"),
    ].join("\n"));

    return sections.join("\n\n");
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
