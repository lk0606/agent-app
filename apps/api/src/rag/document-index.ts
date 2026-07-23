/**
 * 沙箱文档的内存索引（E.7-A 关键词 + E.7-B 向量/hybrid 检索层）。
 *
 * 链路位置：SearchDocsTool.execute() → DocumentIndex.build/search*() → 片段字符串回流 LLM。
 * 扫描边界与 read_file 共用 READ_FILE_ROOT_DIR + 扩展名白名单 + deniedBasenames。
 * 向量数据由 rag:index 写入 document_chunks，运行时 loadVectorChunks() 加载到内存。
 *
 * 三种 search 分数（勿混读 tool output 里的 score=）：
 *   keyword → 命中词整数累加；vector → 余弦 [-1,1]；hybrid → 归一化关键词×0.4 + 余弦×0.6
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { cosineSimilarity } from "./cosine-similarity.js";

export type SearchDocsMode = "keyword" | "vector" | "hybrid";

/** 关键词索引里的一块原文；sourcePath 相对沙箱根，如 sample-notes.txt */
export interface DocumentChunk {
  sourcePath: string;
  chunkIndex: number;
  text: string;
}

/** 检索命中：score 含义随模式变化；text 始终是已存原文（不是再查词） */
export interface SearchMatch {
  sourcePath: string;
  chunkIndex: number;
  score: number;
  text: string;
}

/** 向量索引行：离线 embed 后的 chunk，与 DocumentChunk 同源 text */
interface VectorDocumentChunk extends DocumentChunk {
  embedding: number[];
}

export class DocumentIndex {
  /** keyword/hybrid 用：扫盘切块后的纯文本索引 */
  private chunks: DocumentChunk[] = [];
  /** vector/hybrid 用：从 DB 加载的 {text, embedding}；与 chunks 可并存 */
  private vectorChunks: VectorDocumentChunk[] = [];

  /** 持有沙箱路径与切块/过滤配置；索引内容在 build() / loadVectorChunks() 时填充 */
  constructor(
    private readonly options: {
      rootDir: string;
      allowedExtensions: string[];
      deniedBasenames: string[];
      chunkChars: number;
    },
  ) {}

  /** 遍历沙箱可读文件并切块，写入内存 this.chunks（首次 search 前由 SearchDocsTool 触发） */
  async build(): Promise<void> {
    const rootDir = path.resolve(this.options.rootDir);
    const collected: DocumentChunk[] = [];

    await this.walkDirectory(rootDir, rootDir, collected);

    this.chunks = collected;
  }

  /** 当前关键词索引 chunk 数；0 匹配时写入 tool output 供 LLM 参考 */
  get size(): number {
    return this.chunks.length;
  }

  /** rag:index 用：build() 后的切块列表，供批量 embedding */
  getChunks(): DocumentChunk[] {
    return [...this.chunks];
  }

  /**
   * vector/hybrid：把 document_chunks 行灌进内存。
   * 示例行：{ sourcePath: "sample-notes.txt", chunkIndex: 0, text: "Favorite city: Taipei.", embedding: [0.1, ...] }
   */
  loadVectorChunks(rows: Array<{ sourcePath: string; chunkIndex: number; text: string; embedding: number[] }>): void {
    this.vectorChunks = rows.map((row) => ({
      sourcePath: row.sourcePath,
      chunkIndex: row.chunkIndex,
      text: row.text,
      embedding: row.embedding,
    }));
  }

  get vectorSize(): number {
    return this.vectorChunks.length;
  }

  /**
   * 按模式检索分流。
   * 示例：mode=vector 且 queryEmbedding 有值 → 只走 searchVector；
   *       mode=hybrid → 两路各取 maxResults*2 再 merge，避免单路漏掉另一路高分 chunk。
   */
  searchByMode(
    query: string,
    maxResults: number,
    mode: SearchDocsMode,
    queryEmbedding: number[] | null,
  ): SearchMatch[] {
    if (mode === "keyword") {
      return this.search(query, maxResults);
    }

    if (mode === "vector") {
      // 无 embedding（客户端未配）时不能硬报错到 Tool 层以上，返回空让 execute 写友好提示
      return queryEmbedding ? this.searchVector(queryEmbedding, maxResults) : [];
    }

    // hybrid：先扩召回再合并，最后仍裁到 maxResults
    const keywordMatches = this.search(query, maxResults * 2);
    const vectorMatches = queryEmbedding ? this.searchVector(queryEmbedding, maxResults * 2) : [];
    return mergeHybridMatches(keywordMatches, vectorMatches, maxResults);
  }

  /**
   * 关键词检索：全量 chunk 线性打分 → 过滤 score>0 → 降序 → Top-K。
   * 示例：query="favorite city" → terms=["favorite","city"]，命中 sample-notes 分更高。
   */
  search(query: string, maxResults: number): SearchMatch[] {
    const terms = tokenize(query);

    if (terms.length === 0) {
      return [];
    }

    // fixture 规模小无需倒排；生产千万级应换 ANN/倒排，而不是改打分公式
    const scored = this.chunks
      .map((chunk) => ({
        sourcePath: chunk.sourcePath,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        score: scoreChunk(chunk.text, terms, query),
      }))
      .filter((item) => item.score > 0)
      // 同分按路径稳定排序，避免 eval 结果顺序抖动
      .sort((a, b) => b.score - a.score || a.sourcePath.localeCompare(b.sourcePath))
      .slice(0, maxResults);

    return scored;
  }

  /**
   * 向量检索：每个 chunk 的 score = cosine(queryEmbedding, chunk.embedding)。
   * 示例：score≈1 几乎同向；0.6 约六成相近；只用来排序取 Top-K，不是「及格线」。
   * 命中后直接返回已存 text，不会再按关键词二次打分。
   */
  searchVector(queryEmbedding: number[], maxResults: number): SearchMatch[] {
    if (this.vectorChunks.length === 0) {
      return [];
    }

    return this.vectorChunks
      .map((chunk) => ({
        sourcePath: chunk.sourcePath,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.sourcePath.localeCompare(b.sourcePath))
      .slice(0, maxResults);
  }

  /**
   * 递归遍历沙箱目录，把可读文件切成 chunk 追加到 collected。
   * rootDir 固定为沙箱根，用于算 relativePath（写入 tool output 的 sourcePath）；
   * 过滤规则与 read_file 对齐，避免索引到 .env 或非白名单扩展名。
   */
  private async walkDirectory(rootDir: string, currentDir: string, collected: DocumentChunk[]): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      // 与 list_dir / read_file 一致：隐藏文件不进索引
      if (entry.name.startsWith(".")) {
        continue;
      }

      const absolutePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await this.walkDirectory(rootDir, absolutePath, collected);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const basename = entry.name.toLowerCase();

      if (this.options.deniedBasenames.includes(basename)) {
        continue;
      }

      const extension = path.posix.extname(entry.name).toLowerCase();

      if (!this.options.allowedExtensions.includes(extension)) {
        continue;
      }

      const fileStat = await stat(absolutePath);

      // 符号链接等：Dirent 说是 file 但 stat 可能不是普通文件
      if (!fileStat.isFile()) {
        continue;
      }

      const content = await readFile(absolutePath, "utf8");
      // 相对沙箱根；Windows 反斜杠统一成 /，与 tool output 展示一致
      // 示例：root=/fixtures, file=/fixtures/sample-notes.txt → sourcePath=sample-notes.txt
      const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, "/");
      const parts = chunkText(content, this.options.chunkChars);

      parts.forEach((text, chunkIndex) => {
        collected.push({ sourcePath: relativePath, chunkIndex, text });
      });
    }
  }
}

/**
 * 把文件正文切成检索用片段：先按空行分段，超长段再滑动窗口切（带 overlap）。
 * 示例：maxChars=10, 段="abcdefghijklmn" → 可能得到 "abcdefghij" + 带 overlap 的后续窗。
 */
export function chunkText(content: string, maxChars: number): string[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();

  if (normalized.length === 0) {
    return [];
  }

  const paragraphs = normalized.split(/\n\s*\n+/).map((part) => part.trim()).filter((part) => part.length > 0);
  const chunks: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      chunks.push(paragraph);
      continue;
    }

    // overlap 默认 min(50, maxChars/5)：降低「关键词刚好落在窗口边界」的漏召
    const overlap = Math.min(50, Math.floor(maxChars / 5));

    for (let start = 0; start < paragraph.length; start += maxChars - overlap) {
      chunks.push(paragraph.slice(start, start + maxChars));
    }
  }

  return chunks.length > 0 ? chunks : [normalized.slice(0, maxChars)];
}

/**
 * 把 query 拆成去重检索词。
 * 示例：`"Favorite City!"` → `["favorite","city"]`；
 *       `"台北"`（无空格）→ 先整词再不行则单字 `["台","北"]`。
 */
export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase();
  const words = lowered
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (words.length > 0) {
    return [...new Set(words)];
  }

  // 纯中文无分隔时退化为单字，避免完全无 token 导致 search 直接空返回
  return [...new Set(lowered.split(""))].filter((char) => /[\u4e00-\u9fff]/.test(char));
}

/**
 * 单个 chunk 与 query 的关键词相关度。
 * 示例：terms=["favorite","city"]，chunk 含两者 → +2；整句 phrase 也命中再 +2。
 */
function scoreChunk(chunkTextValue: string, terms: string[], rawQuery: string): number {
  const haystack = chunkTextValue.toLowerCase();
  let score = 0;

  // 每个命中 token +1；阶段 1 无语义，同义词（台北/Taipei）靠不上，要靠 vector/hybrid
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
    }
  }

  // 连续词组 bonus：rawQuery 清洗后长度≥4 且整段出现在 chunk
  const phrase = rawQuery
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]+/gi, " ")
    .trim();

  if (phrase.length >= 4 && haystack.includes(phrase)) {
    score += 2;
  }

  return score;
}

/**
 * hybrid 合并：两路独立打分 → 按 sourcePath#chunkIndex 对齐加权。
 *
 * 为什么要归一化关键词分：keyword 是整数（可能 1、4、6），余弦是 0~1；
 * 不除以 keywordMax 会让关键词路淹没向量路。
 *
 * 示例（简化）：
 *   keywordMax=4，某 chunk keyword=4 → 归一化 1.0 → ×0.4 = 0.4
 *   同 chunk 余弦=0.9 → ×0.6 = 0.54
 *   合并 score = 0.4 + 0.54 = 0.94
 */
function mergeHybridMatches(
  keywordMatches: SearchMatch[],
  vectorMatches: SearchMatch[],
  maxResults: number,
): SearchMatch[] {
  const keywordMax = keywordMatches.reduce((max, item) => Math.max(max, item.score), 0);
  const merged = new Map<string, SearchMatch>();

  for (const match of keywordMatches) {
    const key = `${match.sourcePath}#${match.chunkIndex}`;
    const normalizedKeyword = keywordMax > 0 ? match.score / keywordMax : 0;
    merged.set(key, { ...match, score: normalizedKeyword * 0.4 });
  }

  for (const match of vectorMatches) {
    const key = `${match.sourcePath}#${match.chunkIndex}`;
    const existing = merged.get(key);
    const vectorScore = match.score * 0.6;

    if (existing) {
      // 两路都命中同一 chunk：分数相加（不是取 max）
      merged.set(key, { ...existing, score: existing.score + vectorScore });
    } else {
      // 仅向量命中（典型：中文「台北」对上英文 Taipei）
      merged.set(key, { ...match, score: vectorScore });
    }
  }

  return [...merged.values()]
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.sourcePath.localeCompare(b.sourcePath))
    .slice(0, maxResults);
}
