import type { Tool, ToolInput } from "./tool.js";

export class HttpFetchTool implements Tool {
  readonly name = "http_fetch";
  readonly description = "Fetches a web page and returns a compact plain-text summary source for reading and summarization tasks.";

  async execute(input: ToolInput): Promise<string> {
    const url = this.extractUrl(input.input);
    const response = await fetch(url, {
      headers: {
        "user-agent": "agent-app/0.1 (+https://example.local)",
        accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HttpFetchTool request failed with status ${response.status} for ${url}`);
    }

    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "unknown";
    const compactText = this.toPlainText(body).slice(0, 4000);

    return [`URL: ${url}`, `Content-Type: ${contentType}`, "Content Preview:", compactText].join("\n\n");
  }

  private extractUrl(input: string): string {
    const matched = input.match(/https?:\/\/\S+/i);

    if (!matched) {
      throw new Error("HttpFetchTool requires an absolute URL in the input.");
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
