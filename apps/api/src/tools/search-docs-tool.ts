/**
 * 沙箱文档检索 Tool（E.7-A 关键词 + E.7-B 向量/hybrid）。
 *
 * 在 Agent 链路中的位置：
 *   Planner 选 search_docs → execute() → DocumentIndex 打分取 Top-K
 *   → 格式化纯文本 → 写入 tool_calls.output → answerWithTool() 组织给人看的 summary。
 *
 * 三种模式（SEARCH_DOCS_MODE）分数含义不同：
 *   - keyword：字面命中分（整数累加），与余弦无关
 *   - vector：score = 余弦相似度，约 [-1,1]；文本场景常落在 [0,1]。1≈同向满分，0.6≈六成相近
 *   - hybrid：关键词归一化×0.4 + 余弦×0.6，分数不是「纯百分制」
 *
 * 依赖：vector/hybrid 须先 `pnpm run rag:index` 写入 document_chunks；
 * keyword 仅需运行时扫沙箱切块，不调 embedding API。
 */
import { AppError } from "../shared/app-error.js";
import type { EmbeddingClient } from "../llm/embedding-client.js";
import { DocumentIndex, type SearchDocsMode } from "../rag/document-index.js";
import type { PostgresDocumentChunkStore } from "../rag/document-chunk-store.js";
import type { Tool, ToolInput } from "./tool.js";

export class SearchDocsTool implements Tool {
  readonly name = "search_docs";
  /** 给 Planner/function calling 看的说明；例子要贴近 fixture，降低胡选工具概率 */
  readonly description =
    "Searches indexed sandbox documents for relevant text snippets. Pass a natural-language query such as favorite city or Japan travel notes.";

  private readonly index: DocumentIndex;

  /**
   * 用 env 沙箱配置构造空的 DocumentIndex；真正建索引在首次 execute 时按模式懒加载，
   * 避免服务启动就扫盘 / 拉全表（keyword 与 vector 各有一条懒加载路径）。
   */
  constructor(
    private readonly options: {
      rootDir: string;
      allowedExtensions: string[];
      deniedBasenames: string[];
      /** Top-K：最终返回几条片段（默认来自 SEARCH_DOCS_MAX_RESULTS） */
      maxResults: number;
      chunkChars: number;
      searchMode: SearchDocsMode;
      /** vector/hybrid 才需要；keyword 可为 null */
      embeddingClient: EmbeddingClient | null;
      /** 读 document_chunks；vector/hybrid 才需要 */
      chunkStore: PostgresDocumentChunkStore | null;
    },
  ) {
    this.index = new DocumentIndex({
      rootDir: options.rootDir,
      allowedExtensions: options.allowedExtensions,
      deniedBasenames: options.deniedBasenames,
      chunkChars: options.chunkChars,
    });
  }

  /**
   * 懒加载去重用的 Promise 句柄。
   * 并发两次 execute 时共用同一次 build，避免重复扫盘；不要写成「每次 new Promise」。
   */
  private buildPromise: Promise<void> | null = null;
  /** 同上，针对 listAll + loadVectorChunks */
  private vectorLoadPromise: Promise<void> | null = null;

  /** keyword/hybrid：遍历 READ_FILE_ROOT_DIR 切块进内存（无 embedding） */
  private async ensureKeywordIndex(): Promise<void> {
    if (!this.buildPromise) {
      this.buildPromise = this.index.build();
    }

    await this.buildPromise;
  }

  /**
   * vector/hybrid：从 Postgres document_chunks 拉 {text, embedding} 进内存。
   * 在线检索不做 SQL 向量距离，而是应用层余弦全量扫（fixture 规模够用）。
   */
  private async ensureVectorIndex(): Promise<void> {
    if (!this.vectorLoadPromise) {
      this.vectorLoadPromise = this.loadVectorIndex();
    }

    await this.vectorLoadPromise;
  }

  private async loadVectorIndex(): Promise<void> {
    // keyword 模式构造时 chunkStore 可为 null；此时直接跳过
    if (!this.options.chunkStore) {
      return;
    }

    const rows = await this.options.chunkStore.listAll();
    this.index.loadVectorChunks(rows);
  }

  /**
   * 按当前模式只准备需要的索引。
   * 示例：mode=keyword → 只扫盘；mode=vector → 只拉 DB；mode=hybrid → 两边都要。
   */
  private async ensureIndexes(): Promise<void> {
    const mode = this.options.searchMode;

    if (mode === "keyword" || mode === "hybrid") {
      await this.ensureKeywordIndex();
    }

    if (mode === "vector" || mode === "hybrid") {
      await this.ensureVectorIndex();
    }
  }

  /**
   * Tool 入口数据流：
   *   1. 从 LLM 自然语言抽出 query（剥掉「请用 search_docs」等前缀）
   *   2. 按模式懒加载索引
   *   3. vector/hybrid：query 只 embed 一次 → number[]
   *   4. DocumentIndex.searchByMode → Top-K（K=maxResults）
   *   5. 把已存的 match.text（原文片段）格式化返回；不在这里再按词二次打分
   *
   * 返回值写入 tool_calls.output，供 LLM 读；result.summary 才是最终人话。
   */
  async execute(input: ToolInput): Promise<string> {
    const query = this.extractQuery(input.input);

    if (query.length === 0) {
      throw new AppError("BAD_REQUEST", "SearchDocsTool requires a non-empty search query.");
    }

    await this.ensureIndexes();

    const mode = this.options.searchMode;
    let queryEmbedding: number[] | null = null;

    // 在线只对「用户这句话」调一次 embedding；chunk 向量离线 rag:index 已算好
    if ((mode === "vector" || mode === "hybrid") && this.options.embeddingClient) {
      // 未跑 rag:index 时 vectorSize=0；返回可操作提示，避免空数组余弦或误报「无相关文档」
      if (this.index.vectorSize === 0) {
        return [
          `Query: ${query}`,
          "Matches: 0",
          "Vector index is empty. Run `pnpm run rag:index` after setting SEARCH_DOCS_MODE=vector|hybrid.",
          `Search mode: ${mode}`,
        ].join("\n");
      }

      // embedTexts 批量 API；这里只传一个 query，取 [0]
      const [embedding] = await this.options.embeddingClient.embedTexts([query]);
      queryEmbedding = embedding ?? null;
    }

    // keyword：字面打分；vector：score=余弦；hybrid：两路加权合并（见 document-index.mergeHybridMatches）
    const matches = this.index.searchByMode(query, this.options.maxResults, mode, queryEmbedding);

    if (matches.length === 0) {
      return [
        `Query: ${query}`,
        "Matches: 0",
        "No relevant snippets were found in the sandbox document index.",
        `Indexed chunks: ${this.index.size}`,
        `Vector chunks: ${this.index.vectorSize}`,
        `Search mode: ${mode}`,
      ].join("\n");
    }

    // 输出形态示例：
    //   [1] sample-notes.txt#0 (score=0.9123)
    //   Favorite city: Taipei.
    // score 直接展示检索分；text 是入库原文，命中后原样给 LLM（不做「再查词打分」）
    const lines = matches.map((match, index) => {
      return [`[${index + 1}] ${match.sourcePath}#${match.chunkIndex} (score=${match.score.toFixed(4)})`, match.text].join(
        "\n",
      );
    });

    return [`Query: ${query}`, `Matches: ${matches.length}`, `Search mode: ${mode}`, "", ...lines].join("\n");
  }

  /**
   * 从 LLM 自然语言里抽出检索 query。
   * 示例：
   *   `请用 search_docs 搜索「台北」` → `台北`
   *   `use search_docs to find favorite city` → `find favorite city`（去前缀后整段）
   *   有中英文引号时优先取引号内，避免把指令当检索词。
   */
  private extractQuery(rawInput: string): string {
    const trimmed = rawInput.trim();

    if (trimmed.length === 0) {
      return "";
    }

    // 剥英文 / 中文「请用 search_docs …」壳，剩下才是真正检索句
    const withoutToolPrefix = trimmed
      .replace(/^(please\s+)?(use\s+)?search_docs\s*(tool)?\s*(to\s+)?/i, "")
      .replace(/^请用\s*search_docs\s*(工具)?\s*(搜索|查找)?\s*/i, "")
      .trim();

    const quoted = withoutToolPrefix.match(/["'「『]([^"'」』]+)["'」』]/);

    if (quoted?.[1]) {
      return quoted[1].trim();
    }

    // 去前缀后若为空（极端：整句只有工具名），回退到原始 trimmed
    return withoutToolPrefix.length > 0 ? withoutToolPrefix : trimmed;
  }
}
