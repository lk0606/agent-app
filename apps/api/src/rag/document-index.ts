/**
 * 沙箱文档的内存索引（E.7-A 检索层，不含 Agent 编排）。
 *
 * 链路位置：SearchDocsTool.execute() → DocumentIndex.build/search() → 片段字符串回流 LLM。
 * 扫描边界与 read_file 共用 READ_FILE_ROOT_DIR + 扩展名白名单 + deniedBasenames。
 * 阶段 1：关键词打分；阶段 2 可换 embedding/pgvector，本类对外接口可保持不变。
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface DocumentChunk {
  sourcePath: string;
  chunkIndex: number;
  text: string;
}

export interface SearchMatch {
  sourcePath: string;
  chunkIndex: number;
  score: number;
  text: string;
}

export class DocumentIndex {
  private chunks: DocumentChunk[] = [];

  /** 持有沙箱路径与切块/过滤配置；索引内容在 build() 时填充 */
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

  /** 当前索引中的 chunk 总数；0 匹配时写入 tool output 供 LLM 参考 */
  get size(): number {
    return this.chunks.length;
  }

  /**
   * 对 query 做关键词检索，返回按分数降序的 top-k 片段。
   * 输入：用户/模型传入的检索词；输出：score>0 的 SearchMatch[]，最多 maxResults 条。
   */
  search(query: string, maxResults: number): SearchMatch[] {
    const terms = tokenize(query);

    if (terms.length === 0) {
      return [];
    }

    // 全量 chunk 线性打分；fixture 规模小无需倒排索引，阶段 2 向量检索可换别的数据结构
    const scored = this.chunks
      .map((chunk) => ({
        sourcePath: chunk.sourcePath,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        score: scoreChunk(chunk.text, terms, query),
      }))
      .filter((item) => item.score > 0)
      // 分相同则按路径稳定排序，避免结果顺序随运行环境抖动
      .sort((a, b) => b.score - a.score || a.sourcePath.localeCompare(b.sourcePath))
      .slice(0, maxResults);

    return scored;
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
      // 相对沙箱根的路径，供 search_docs output 展示来源（如 sample-notes.txt#0）
      const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, "/");
      const parts = chunkText(content, this.options.chunkChars);

      parts.forEach((text, chunkIndex) => {
        collected.push({ sourcePath: relativePath, chunkIndex, text });
      });
    }
  }
}

/** 把文件正文切成检索用片段：先按空行分段，超长段再滑动窗口切（带 overlap） */
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

    const overlap = Math.min(50, Math.floor(maxChars / 5));

    // 滑动窗口切超长段，overlap 降低「关键词刚好落在边界两侧」的漏召
    for (let start = 0; start < paragraph.length; start += maxChars - overlap) {
      chunks.push(paragraph.slice(start, start + maxChars));
    }
  }

  return chunks.length > 0 ? chunks : [normalized.slice(0, maxChars)];
}

/** 把 query 拆成去重检索词；英文按词切，纯中文无空格时退化为单字 */
export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase();
  const words = lowered
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (words.length > 0) {
    return [...new Set(words)];
  }

  // 纯中文无分隔时退化为单字，避免完全无 token
  return [...new Set(lowered.split(""))].filter((char) => /[\u4e00-\u9fff]/.test(char));
}

/** 计算单个 chunk 与 query 的相关度：命中 token 各 +1，连续短语再 +2 */
function scoreChunk(chunkTextValue: string, terms: string[], rawQuery: string): number {
  const haystack = chunkTextValue.toLowerCase();
  let score = 0;

  // 每个命中 token +1；阶段 1 无语义，同义词（台北/Taipei）靠不上
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
    }
  }

  // 连续英文词组在 chunk 中出现时加分（如 favorite city）
  const phrase = rawQuery
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]+/gi, " ")
    .trim();

  if (phrase.length >= 4 && haystack.includes(phrase)) {
    score += 2;
  }

  return score;
}
