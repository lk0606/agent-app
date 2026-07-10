/**
 * 沙箱文档关键词检索 Tool（E.7-A）。
 *
 * 链路：Planner 选 search_docs → execute() → DocumentIndex → 格式化片段
 *       → tool_calls 表 → answerWithTool() 组织 summary。
 * 与 read_file 共用沙箱配置；路径明确用 read_file，跨文件模糊查找用本工具。
 */
import { AppError } from "../shared/app-error.js";
import { DocumentIndex } from "../rag/document-index.js";
import type { Tool, ToolInput } from "./tool.js";

export class SearchDocsTool implements Tool {
  readonly name = "search_docs";
  readonly description =
    "Searches indexed sandbox documents for relevant text snippets. Pass a natural-language query such as favorite city or Japan travel notes.";

  private readonly index: DocumentIndex;

  /** 用 env 沙箱配置构造 DocumentIndex；索引内容在首次 execute 时懒加载 */
  constructor(
    private readonly options: {
      rootDir: string;
      allowedExtensions: string[];
      deniedBasenames: string[];
      maxResults: number;
      chunkChars: number;
    },
  ) {
    this.index = new DocumentIndex({
      rootDir: options.rootDir,
      allowedExtensions: options.allowedExtensions,
      deniedBasenames: options.deniedBasenames,
      chunkChars: options.chunkChars,
    });
  }

  /** 首次 execute 前懒加载索引，避免 createAgentRuntime 时阻塞 HTTP 启动过久 */
  private buildPromise: Promise<void> | null = null;

  /** 保证 DocumentIndex.build() 只执行一次，并发 execute 共用同一 Promise */
  private async ensureIndex(): Promise<void> {
    if (!this.buildPromise) {
      this.buildPromise = this.index.build();
    }

    await this.buildPromise;
  }

  /**
   * Tool 入口：抽 query → 检索 top-k → 格式化成纯文本给 answerWithTool。
   * 返回字符串写入 tool_calls.output，不是最终给人看的 summary。
   */
  async execute(input: ToolInput): Promise<string> {
    const query = this.extractQuery(input.input);

    if (query.length === 0) {
      throw new AppError("BAD_REQUEST", "SearchDocsTool requires a non-empty search query.");
    }

    await this.ensureIndex();

    const matches = this.index.search(query, this.options.maxResults);

    if (matches.length === 0) {
      // 0 匹配也返回结构化文本，便于 LLM 向用户解释「没找到」
      return [
        `Query: ${query}`,
        "Matches: 0",
        "No relevant snippets were found in the sandbox document index.",
        `Indexed chunks: ${this.index.size}`,
      ].join("\n");
    }

    // 输出给 answerWithTool 的 toolOutput，非给人扫的 UI；手测可用 jq 抽 summary
    const lines = matches.map((match, index) => {
      return [`[${index + 1}] ${match.sourcePath}#${match.chunkIndex} (score=${match.score})`, match.text].join("\n");
    });

    return [`Query: ${query}`, `Matches: ${matches.length}`, "", ...lines].join("\n");
  }

  /** 从 LLM 自然语言里抽出检索 query；去掉「请用 search_docs」等前缀，优先取引号内短语 */
  private extractQuery(rawInput: string): string {
    const trimmed = rawInput.trim();

    if (trimmed.length === 0) {
      return "";
    }

    const withoutToolPrefix = trimmed
      .replace(/^(please\s+)?(use\s+)?search_docs\s*(tool)?\s*(to\s+)?/i, "")
      .replace(/^请用\s*search_docs\s*(工具)?\s*(搜索|查找)?\s*/i, "")
      .trim();

    const quoted = withoutToolPrefix.match(/["'「『]([^"'」』]+)["'」』]/);

    if (quoted?.[1]) {
      return quoted[1].trim();
    }

    return withoutToolPrefix.length > 0 ? withoutToolPrefix : trimmed;
  }
}
