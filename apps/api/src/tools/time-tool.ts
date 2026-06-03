import type { Tool, ToolInput } from "./tool.js";

export class TimeTool implements Tool {
  readonly name = "time";
  readonly description = "Returns the current server time in ISO format for time-sensitive questions.";

  async execute(_input: ToolInput): Promise<string> {
    return new Date().toISOString();
  }
}
