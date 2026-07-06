/** Tool 插件接口：Planner 通过 name 匹配后调用 execute() */
export interface ToolInput {
  input: string;
}

export interface Tool {
  name: string;
  description: string;
  execute(input: ToolInput): Promise<string>;
}
