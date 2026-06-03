export interface ToolInput {
  input: string;
}

export interface Tool {
  name: string;
  description: string;
  execute(input: ToolInput): Promise<string>;
}
