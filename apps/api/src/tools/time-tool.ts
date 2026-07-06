/** 示例工具：返回服务器当前时间，用于验证 function calling 链路 */
import type { Tool, ToolInput } from "./tool.js";

export class TimeTool implements Tool {
  readonly name = "time";
  readonly description = "Returns the current server time in ISO format for time-sensitive questions.";

  async execute(_input: ToolInput): Promise<string> {
    return new Date().toISOString();
  }
}
