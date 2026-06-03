import type { Tool, ToolInput } from "./tool.js";

export class EchoTool implements Tool {
  readonly name = "echo";
  readonly description = "Echoes the input back to the runtime for smoke testing.";

  async execute(input: ToolInput): Promise<string> {
    return `EchoTool output: ${input.input}`;
  }
}
