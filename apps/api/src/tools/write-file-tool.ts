/**
 * E.10：沙箱写文件工具；默认 requiresConfirmation=true。
 * 路径规则对齐 read_file（resolve + 前缀校验 + 扩展名白名单），防 ../ 越界。
 *
 * 常规执行顺序（跨模块）：
 * 1. create-agent-runtime 注册本工具 → Planner llm.plan 按 name 选中 write_file
 * 2. Planner 因 requiresConfirmation 先挂起（ConfirmationRegistry.wait + SSE awaiting_confirmation）
 * 3. 人 POST .../confirm approve 后，才进入本类 execute()
 * 4. execute 返回摘要 → Planner 记 tool_calls / 回流 LLM 生成最终回答
 * 旁路：reject → 不进入 execute；路径/扩展名非法 → BAD_REQUEST（不写盘）
 *
 * 本文件执行链路：见下方方法/步骤上的 [1]…[5]
 *   [1] execute → [2] parseInput → [3] resolveSafePath → [4] 字节校验 → [5] 写盘并返回
 *
 * 输入格式（任选）：
 * - 两行：`相对路径\n正文`（手测推荐）
 * - JSON：`{"path":"hitl-demo.txt","content":"hello"}`
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { AppError } from "../shared/app-error.js";
import type { Tool, ToolInput } from "./tool.js";

export class WriteFileTool implements Tool {
  readonly name = "write_file";
  readonly description =
    "Writes a text file inside the configured sandbox directory. Input must be either two lines (relative path on the first line, file content on the following lines) or JSON {\"path\":\"notes/demo.txt\",\"content\":\"...\"}. This tool requires human confirmation before execution.";
  /** E.10：真正写盘前必须经 POST /tasks/:id/confirm 批准 */
  readonly requiresConfirmation = true;

  constructor(
    private readonly options: {
      rootDir: string;
      maxBytes: number;
      allowedExtensions: string[];
      deniedBasenames: string[];
    },
  ) {}

  /** [1] 入口：串起解析 → 安全路径 → 校验 → 写盘，返回摘要给 Planner */
  async execute(input: ToolInput): Promise<string> {
    const { relativePath, content } = this.parseInput(input.input);
    const absolutePath = this.resolveSafePath(relativePath);

    // [4] 按 UTF-8 字节计，与 read_file 的 maxBytes 同一量纲（勿用 content.length）
    const bytes = Buffer.byteLength(content, "utf8");

    if (bytes > this.options.maxBytes) {
      throw new AppError(
        "BAD_REQUEST",
        `WriteFileTool blocked content larger than ${this.options.maxBytes} bytes: ${relativePath}`,
      );
    }

    // [5] 允许 notes/a.txt：先建父目录再写；摘要回流 Planner（非直接给人看）
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");

    return [`Path: ${relativePath}`, `Bytes written: ${bytes}`, "Status: written"].join("\n");
  }

  /**
   * [2] 从 LLM 输入抽 path + content；两种形态并存是因为模型有时出 JSON、有时出两行文本。
   * 示例：`hitl-demo.txt\nhello` → path=hitl-demo.txt, content=hello
   * 示例：`{"path":"a.txt","content":"x"}` → 同上字段
   */
  private parseInput(rawInput: string): { relativePath: string; content: string } {
    const trimmed = rawInput.trim();

    if (trimmed.length === 0) {
      throw new AppError("BAD_REQUEST", "WriteFileTool requires a relative path and content.");
    }

    // 形态 A：JSON（模型常把 function arguments 整段塞进来）
    // 合法例：{"path":"hitl-demo.txt","content":"hello-hitl"}
    // 非法例：{"path":"a.txt"}（缺 content）→ 下方 BAD_REQUEST，勿再当两行文本解析
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed) as { path?: unknown; content?: unknown };

        if (typeof parsed.path === "string" && typeof parsed.content === "string") {
          return { relativePath: parsed.path.trim(), content: parsed.content };
        }
      } catch {
        // 以 { 开头但 JSON.parse 失败（截断/尾逗号）→ 明确报 JSON 错，避免误走两行分支
        throw new AppError("BAD_REQUEST", "WriteFileTool received invalid JSON input.");
      }

      throw new AppError(
        "BAD_REQUEST",
        'WriteFileTool JSON input must be {"path":"...","content":"..."}.',
      );
    }

    // 形态 B：首行相对路径，其余为正文（手测 / smoke 推荐）
    // 例：hitl-demo.txt\nhello-hitl → path=hitl-demo.txt, content=hello-hitl
    const newline = trimmed.indexOf("\n");

    if (newline === -1) {
      // 只有一行无法区分 path/content；拒绝，避免把整段当成文件名
      throw new AppError(
        "BAD_REQUEST",
        "WriteFileTool expects path on the first line and content on the following lines.",
      );
    }

    return {
      relativePath: trimmed.slice(0, newline).trim(),
      // 去掉 path 后多出的空行（模型常写成 path\n\ncontent）
      content: trimmed.slice(newline + 1).replace(/^\n/, ""),
    };
  }

  /**
   * [3] 相对路径 → 沙箱内绝对路径；与 read_file 同套规则，防 ../ 与绝对路径逃逸。
   * 例：`notes/a.txt` → `<READ_FILE_ROOT_DIR>/notes/a.txt`；`../.env` → BAD_REQUEST
   */
  private resolveSafePath(relativePath: string): string {
    const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/"));

    // 空 / 仅 "." / 以 ../ 开头 / 绝对路径：一律拦，不依赖后面的前缀校验
    if (
      normalized.length === 0 ||
      normalized === "." ||
      normalized.startsWith("../") ||
      path.posix.isAbsolute(normalized)
    ) {
      throw new AppError("BAD_REQUEST", `WriteFileTool blocked unsafe path: ${relativePath}`);
    }

    const basename = path.posix.basename(normalized);

    // 与 read_file 共用 denylist（如 .env），避免「能写敏感文件名」绕过读侧限制
    if (this.options.deniedBasenames.includes(basename)) {
      throw new AppError("BAD_REQUEST", `WriteFileTool blocked denied basename: ${basename}`);
    }

    const extension = path.posix.extname(normalized).toLowerCase();

    if (!this.options.allowedExtensions.includes(extension)) {
      throw new AppError(
        "BAD_REQUEST",
        `WriteFileTool blocked extension "${extension}". Allowed: ${this.options.allowedExtensions.join(", ")}`,
      );
    }

    const absolutePath = path.resolve(this.options.rootDir, normalized);
    const rootResolved = path.resolve(this.options.rootDir);
    // 前缀校验：resolve 后必须仍落在 root 下（防 notes/../../etc/passwd 这类归一化逃逸）
    const rootPrefix = rootResolved.endsWith(path.sep) ? rootResolved : `${rootResolved}${path.sep}`;

    if (absolutePath !== rootResolved && !absolutePath.startsWith(rootPrefix)) {
      throw new AppError("BAD_REQUEST", `WriteFileTool blocked path outside sandbox: ${relativePath}`);
    }

    return absolutePath;
  }
}
