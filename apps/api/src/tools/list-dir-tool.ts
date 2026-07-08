/**
 * 沙箱列目录工具：Planner 选中 list_dir 后由 TaskRunner 调 execute()，结果写入 tool_calls 并回流 LLM。
 * 与 read_file 共用 READ_FILE_ROOT_DIR；路径校验（resolve + 前缀）一致，但允许空路径表示根目录。
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { AppError } from "../shared/app-error.js";
import type { Tool, ToolInput } from "./tool.js";

export class ListDirTool implements Tool {
  readonly name = "list_dir";
  readonly description =
    "Lists files and subdirectories inside the configured sandbox directory. Pass a relative path such as . or notes, or leave empty for the sandbox root.";

  constructor(
    private readonly options: {
      rootDir: string;
      maxEntries: number;
    },
  ) {}

  async execute(input: ToolInput): Promise<string> {
    // LLM 自然语言 → 相对路径 → 沙箱绝对路径 → readdir → 格式化 listing 字符串
    const relativePath = this.extractRelativePath(input.input);
    const absolutePath = this.resolveSafePath(relativePath);

    let dirStat;

    try {
      dirStat = await stat(absolutePath);
    } catch {
      throw new AppError("BAD_REQUEST", `ListDirTool could not access "${relativePath}".`);
    }

    if (!dirStat.isDirectory()) {
      throw new AppError("BAD_REQUEST", `ListDirTool only supports directories: ${relativePath}`);
    }

    const entries = await readdir(absolutePath, { withFileTypes: true });
    // withFileTypes: true → 返回 fs.Dirent[]（含 isDirectory/isFile），不是 string[]
    // 只列当前目录一层子项名字，不递归子目录；详见 docs/backend-learning/list-dir-tool-notes.md
    const visible = entries
      .filter((entry) => !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name));

    const truncated = visible.length > this.options.maxEntries;
    const listed = visible.slice(0, this.options.maxEntries);
    const lines = listed.map((entry) => {
      // entry 是 Node fs.Dirent；isDirectory/isFile 为原生方法，均 false 时标 other（符号链接/套接字等）
      // 输出 `类型\t名字`（仅文件名，非完整路径），例：file\tsample-notes.txt
      const kind = entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other";

      return `${kind}\t${entry.name}`;
    });

    return [
      `Path: ${relativePath}`,
      `Entries: ${listed.length}${truncated ? ` (truncated, max ${this.options.maxEntries})` : ""}`,
      "Listing:",
      ...lines,
    ].join("\n");
  }

  /**
   * 从 LLM 传入的自然语言里抽出相对路径；空输入表示列沙箱根目录。
   *
   * 示例：
   * - `""` / `"列出根目录"` → `"."`
   * - `"路径: notes/demo"` → `"notes/demo"`
   * - `"/etc"` → `"/etc"`（保留前导 `/`，交给 resolveSafePath 拦截）
   */
  private extractRelativePath(rawInput: string): string {
    const trimmed = rawInput.trim();

    if (trimmed.length === 0) {
      return ".";
    }

    // 保留绝对路径形态，交给 resolveSafePath 拦截（勿 strip 前导 /）
    if (trimmed.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
      return trimmed.replace(/\\/g, "/");
    }

    const quoted = trimmed.match(/["'`]?([^"'`\n]+?)["'`]?$/);
    const candidate = (quoted?.[1] ?? trimmed).trim();
    const pathLike = candidate.match(/(?:^|[\s:：])([\w./-]+)/)?.[1] ?? candidate;
    const normalized = pathLike.replace(/^\.?\//, "").replace(/\\/g, "/");

    return normalized.length === 0 ? "." : normalized;
  }

  /**
   * 把相对路径解析成沙箱内的绝对路径；越界或绝对路径直接 BAD_REQUEST。
   *
   * 示例（rootDir = `/app/evals/fixtures`）：
   * - `"."` → `/app/evals/fixtures`
   * - `"notes"` → `/app/evals/fixtures/notes`
   * - `"../etc"` / `"/etc"` → 抛 BAD_REQUEST
   */
  private resolveSafePath(relativePath: string): string {
    const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/"));

    if (normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
      throw new AppError("BAD_REQUEST", `ListDirTool blocked unsafe path: ${relativePath}`);
    }

    const rootDir = path.resolve(this.options.rootDir);
    const absolutePath = path.resolve(rootDir, normalized === "." ? "" : normalized);

    // 必须落在 rootDir 子树内（防 ../../etc 类路径穿越）
    if (absolutePath !== rootDir && !absolutePath.startsWith(`${rootDir}${path.sep}`)) {
      throw new AppError("BAD_REQUEST", `ListDirTool blocked path outside sandbox: ${relativePath}`);
    }

    return absolutePath;
  }
}
