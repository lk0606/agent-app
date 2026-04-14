import { AppError } from "../shared/app-error.js";
import type { Tool, ToolInput } from "./tool.js";

export class HttpFetchTool implements Tool {
  readonly name = "http_fetch";
  readonly description = "Fetches a web page and returns a compact plain-text summary source for reading and summarization tasks.";

  constructor(private readonly options: { timeoutMs: number; retries: number; maxChars: number }) {}

  async execute(input: ToolInput): Promise<string> {
    const url = this.extractUrl(input.input);
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.options.retries + 1; attempt += 1) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(this.options.timeoutMs),
          headers: {
            "user-agent": "agent-app/0.1 (+https://example.local)",
            accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
          },
        });

        if (!response.ok) {
          throw new AppError("NETWORK_ERROR", `HttpFetchTool request failed with status ${response.status} for ${url}`);
        }

        const body = await response.text();
        const contentType = response.headers.get("content-type") ?? "unknown";
        const compactText = this.toPlainText(body).slice(0, this.options.maxChars);

        return [
          `URL: ${url}`,
          `Content-Type: ${contentType}`,
          `Truncated: ${body.length > compactText.length}`,
          "Content Preview:",
          compactText,
        ].join("\n\n");
      } catch (error: unknown) {
        lastError = error;

        if (attempt > this.options.retries) {
          break;
        }
      }
    }

    if (lastError instanceof DOMException && lastError.name === "TimeoutError") {
      throw new AppError("TIMEOUT_ERROR", `HttpFetchTool timed out for ${url}`);
    }

    if (lastError instanceof AppError) {
      throw new AppError(lastError.code, lastError.message, { url });
    }

    throw new AppError("TOOL_ERROR", `HttpFetchTool failed for ${url}`, { cause: String(lastError) });
  }

  private extractUrl(input: string): string {
    const matched = input.match(/https?:\/\/\S+/i);

    if (!matched) {
      throw new AppError("BAD_REQUEST", "HttpFetchTool requires an absolute URL in the input.");
    }

    return matched[0];
  }

  private toPlainText(raw: string): string {
    return raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();
  }
}
