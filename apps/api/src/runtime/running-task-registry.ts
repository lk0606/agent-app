/**
 * 运行中任务的 AbortController 注册表（E.8）。
 *
 * HTTP 层 POST /tasks/:id/cancel 与 SSE 客户端断开时，通过 taskId 找到对应 controller.abort()；
 * TaskRunner 在 run() 开始时 register、结束时 unregister（含成功/失败/取消）。
 * 进程内内存 Map：单实例 Node 进程够用；多实例部署需改成 Redis 等共享协调。
 */
export class RunningTaskRegistry {
  private readonly controllers = new Map<string, AbortController>();

  /** TaskRunner 开跑时登记；同一 taskId 重复 register 会覆盖（不应发生） */
  register(taskId: string, controller: AbortController): void {
    this.controllers.set(taskId, controller);
  }

  unregister(taskId: string): void {
    this.controllers.delete(taskId);
  }

  /**
   * 请求取消：abort 后 Planner 协作点会 throw。
   * @returns true 表示找到了运行中的 controller；false 表示任务已结束或不存在
   */
  abort(taskId: string, reason?: unknown): boolean {
    const controller = this.controllers.get(taskId);

    if (!controller) {
      return false;
    }

    if (!controller.signal.aborted) {
      controller.abort(reason);
    }

    return true;
  }

  has(taskId: string): boolean {
    return this.controllers.has(taskId);
  }
}
