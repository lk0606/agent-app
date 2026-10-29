/** Tool 插件接口：Planner 通过 name 匹配后调用 execute() */
export interface ToolInput {
  input: string;
  /** E.8：取消/超时时由 Planner 注入，可中断的工具（如 wait）应检查此信号 */
  signal?: AbortSignal;
}

export interface Tool {
  name: string;
  description: string;
  /**
   * idempotent 表示“幂等”：相同输入执行一次或多次，对业务状态产生的预期影响等价，
   * 重复执行不会累积额外副作用；不要求每次返回内容相同（例如读取的时间可能变化）。
   * E.16：true 只代表“有资格重试”，仍需错误为 NETWORK_ERROR；false 时不自动重试。
   * write_file 在本项目中保守标为 false：即使覆盖写在特定条件下可以幂等，也不假设重复写入一定安全。
   */
  idempotent: boolean;
  /**
   * E.10：true 时 Planner 在 execute 前挂起（status=awaiting_confirmation），
   * 等 POST /tasks/:id/confirm 批准后再真正执行。
   */
  requiresConfirmation?: boolean;
  execute(input: ToolInput): Promise<string>;
}
