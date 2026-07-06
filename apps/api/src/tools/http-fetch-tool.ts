/**
 * 抓取公网 URL 并返回纯文本预览。
 * 安全：denyHosts / allowHosts、内网 IP 拦截、Content-Type 白名单、响应大小上限。
 */
import { AppError } from "../shared/app-error.js";
import type { Tool, ToolInput } from "./tool.js";

export class HttpFetchTool implements Tool {
  readonly name = "http_fetch";
  readonly description = "Fetches a web page and returns a compact plain-text summary source for reading and summarization tasks.";

  constructor(
    private readonly options: {
      timeoutMs: number;
      retries: number;
      maxChars: number;
      maxResponseBytes: number;
      allowedContentTypes: string[];
      allowHosts: string[];
      denyHosts: string[];
    },
  ) {}

  async execute(input: ToolInput): Promise<string> {
    const url = this.extractUrl(input.input);
    this.validateUrl(url);
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

        const contentType = response.headers.get("content-type") ?? "unknown";
        this.validateContentType(contentType, url);

        const body = await response.text();
        const plainText = this.toPlainText(body);
        const truncatedText = plainText.slice(0, this.options.maxResponseBytes);
        const compactText = truncatedText.slice(0, this.options.maxChars);

        return [
          `URL: ${url}`,
          `Content-Type: ${contentType}`,
          `TruncatedByBytes: ${plainText.length > truncatedText.length}`,
          `TruncatedByChars: ${truncatedText.length > compactText.length}`,
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

  private validateUrl(rawUrl: string): void {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new AppError("BAD_REQUEST", `HttpFetchTool only supports http/https URLs: ${rawUrl}`);
    }

    // 防止 Agent 被诱导访问内网/metadata（SSRF）；denyHosts 可配 localhost 等
    if (this.options.denyHosts.includes(hostname)) {
      throw new AppError("BAD_REQUEST", `HttpFetchTool blocked denied host: ${hostname}`);
    }

    if (this.options.allowHosts.length > 0 && !this.options.allowHosts.includes(hostname)) {
      throw new AppError("BAD_REQUEST", `HttpFetchTool blocked host outside allowlist: ${hostname}`);
    }

    if (isPrivateHost(hostname)) {
      throw new AppError("BAD_REQUEST", `HttpFetchTool blocked private or local host: ${hostname}`);
    }
  }

  private validateContentType(contentType: string, url: string): void {
    const normalized = contentType.toLowerCase();
    const allowed = this.options.allowedContentTypes.some((item) => normalized.startsWith(item.toLowerCase()));

    if (!allowed) {
      throw new AppError("BAD_REQUEST", `HttpFetchTool blocked unsupported content type "${contentType}" for ${url}`);
    }
  }

  private toPlainText(raw: string): string {
    const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const source = bodyMatch?.[1] ?? raw;

    return source
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ")
      .trim();
  }
}

function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost") {
    return true;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const parts = hostname.split(".").map(Number);

    if (parts[0] === 10) {
      return true;
    }

    if (parts[0] === 127) {
      return true;
    }

    if (parts[0] === 192 && parts[1] === 168) {
      return true;
    }

    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
      return true;
    }
  }

  return false;
}
