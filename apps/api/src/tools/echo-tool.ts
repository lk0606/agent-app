/** 冒烟工具：原样回显 input，eval 用来验证「无工具直答」路径 */
import type { Tool, ToolInput } from "./tool.js";

export class EchoTool implements Tool {
  readonly name = "echo";
  readonly description = "Echoes the input back to the runtime for smoke testing.";

  async execute(input: ToolInput): Promise<string> {
    return `EchoTool output: ${input.input}`;
  }
}
