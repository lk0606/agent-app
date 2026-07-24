/** Tool 插件接口：Planner 通过 name 匹配后调用 execute() */
export interface ToolInput {
  input: string;
  /** E.8：取消/超时时由 Planner 注入，可中断的工具（如 wait）应检查此信号 */
  signal?: AbortSignal;
}

export interface Tool {
  name: string;
  description: string;
  execute(input: ToolInput): Promise<string>;
}
