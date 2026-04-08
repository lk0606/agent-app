import OpenAI from "openai";

import type { AnswerRequest, LlmClient, PlanRequest, PlannerDecision } from "./llm-client.js";

export class HunyuanLlmClient implements LlmClient {
  private readonly client: OpenAI;

  constructor(private readonly options: { apiKey: string; model: string; baseURL: string }) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
  }

  async plan(input: PlanRequest): Promise<PlannerDecision> {
    const completion = await this.client.chat.completions.create({
      model: this.options.model,
      messages: [
        {
          role: "system",
          content: [
            "You are a minimal Node agent planner.",
            "Use a tool only when it materially improves accuracy.",
            "If the user asks for current date or time, call the time tool.",
            "If no tool is needed, answer directly.",
          ].join(" "),
        },
        {
          role: "user",
          content: input.userInput,
        },
      ],
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
    });

    const message = completion.choices[0]?.message;
    const toolCall = message?.tool_calls?.[0];

    if (toolCall?.type === "function") {
      const parsedArgs = this.parseToolArguments(toolCall.function.arguments);

      return {
        needsTool: true,
        toolName: toolCall.function.name,
        toolInput: parsedArgs.input ?? input.userInput,
        draftAnswer: "I will use a tool before answering.",
      };
    }

    return {
      needsTool: false,
      toolName: null,
      toolInput: null,
      draftAnswer: this.readMessageContent(message?.content),
    };
  }

  async answerWithTool(input: AnswerRequest): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.options.model,
      messages: [
        {
          role: "system",
          content: [
            "You are a helpful Node agent.",
            "Use the tool result to answer naturally and directly.",
            "Do not mention internal planning unless the user asks.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `User input: ${input.userInput}`,
            `Tool used: ${input.toolName}`,
            `Tool input: ${input.toolInput}`,
            `Tool output:\n${input.toolOutput}`,
          ].join("\n\n"),
        },
      ],
    });

    const message = completion.choices[0]?.message;
    return this.readMessageContent(message?.content);
  }

  private parseToolArguments(argumentsText: string): { input?: string } {
    try {
      const parsed = JSON.parse(argumentsText) as { input?: unknown };
      return typeof parsed.input === "string" ? { input: parsed.input } : {};
    } catch {
      return {};
    }
  }

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
}
