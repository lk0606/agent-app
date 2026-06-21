import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { AppError } from "../shared/app-error.js";
import type { Tool, ToolInput } from "./tool.js";

export class ReadFileTool implements Tool {
  readonly name = "read_file";
  readonly description =
    "Reads a text file inside the configured sandbox directory. Pass a relative path such as sample-notes.txt or notes/demo.md.";

  constructor(
    private readonly options: {
      rootDir: string;
      maxBytes: number;
      allowedExtensions: string[];
      deniedBasenames: string[];
    },
  ) {}

  async execute(input: ToolInput): Promise<string> {
    const relativePath = this.extractRelativePath(input.input);
    const absolutePath = this.resolveSafePath(relativePath);

    let fileStat;

    try {
      fileStat = await stat(absolutePath);
    } catch {
      throw new AppError("BAD_REQUEST", `ReadFileTool could not access "${relativePath}".`);
    }

    if (!fileStat.isFile()) {
      throw new AppError("BAD_REQUEST", `ReadFileTool only supports regular files: ${relativePath}`);
    }

    if (fileStat.size > this.options.maxBytes) {
      throw new AppError("BAD_REQUEST", `ReadFileTool blocked file larger than ${this.options.maxBytes} bytes: ${relativePath}`);
    }

    const content = await readFile(absolutePath, "utf8");
    const truncated = content.length > this.options.maxBytes;
    const body = content.slice(0, this.options.maxBytes);

    return [
      `Path: ${relativePath}`,
      `Bytes: ${fileStat.size}`,
      `Truncated: ${truncated}`,
      "Content:",
      body,
    ].join("\n\n");
  }

  private extractRelativePath(rawInput: string): string {
    const trimmed = rawInput.trim();

    if (trimmed.length === 0) {
      throw new AppError("BAD_REQUEST", "ReadFileTool requires a relative file path in the input.");
    }

    const quoted = trimmed.match(/["'`]?([^"'`\n]+?)["'`]?$/);
    const candidate = (quoted?.[1] ?? trimmed).trim();
    const pathLike = candidate.match(/(?:^|[\s:：])([\w./-]+\.\w+)/)?.[1] ?? candidate;

    return pathLike.replace(/^\.?\//, "").replace(/\\/g, "/");
  }

  private resolveSafePath(relativePath: string): string {
    const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/"));

    if (normalized.length === 0 || normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
      throw new AppError("BAD_REQUEST", `ReadFileTool blocked unsafe path: ${relativePath}`);
    }

    const basename = path.posix.basename(normalized);

    if (basename.startsWith(".") || this.options.deniedBasenames.includes(basename.toLowerCase())) {
      throw new AppError("BAD_REQUEST", `ReadFileTool blocked denied file name: ${basename}`);
    }

    const extension = path.posix.extname(basename).toLowerCase();

    if (!this.options.allowedExtensions.includes(extension)) {
      throw new AppError("BAD_REQUEST", `ReadFileTool blocked unsupported extension "${extension}" for ${relativePath}`);
    }

    const rootDir = path.resolve(this.options.rootDir);
    const absolutePath = path.resolve(rootDir, normalized);

    if (absolutePath !== rootDir && !absolutePath.startsWith(`${rootDir}${path.sep}`)) {
      throw new AppError("BAD_REQUEST", `ReadFileTool blocked path outside sandbox: ${relativePath}`);
    }

    return absolutePath;
  }
}
