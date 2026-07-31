/**
 * 运行中任务的 AbortController 注册表（E.8）。
 * 进程内内存 Map：单实例 Node 进程够用；多实例部署需改成 Redis 等共享协调。
 *
 * 常规执行顺序（跨模块）：
 * 1. TaskRunner.run 开始 → register(taskId, AbortController)
 * 2. Planner / 工具在步进边界或 HTTP 上传入 signal
 * 3. POST /tasks/:id/cancel 或 SSE 断开 / 超时 → abort(taskId) → Planner 抛 CANCELLED
 * 4. TaskRunner finally → unregister(taskId)
 *
 * 本文件执行链路：见下方方法上的 [1]…[4]
 *   [1] register → [2] abort → [3] unregister → [4] has
 */
export class RunningTaskRegistry {
  private readonly controllers = new Map<string, AbortController>();

  /** [1] TaskRunner 开跑时登记；同一 taskId 重复 register 会覆盖（不应发生） */
  register(taskId: string, controller: AbortController): void {
    this.controllers.set(taskId, controller);
  }

  /** [3] TaskRunner finally：无论成功/失败/取消都卸掉，避免 Map 泄漏 */
  unregister(taskId: string): void {
    this.controllers.delete(taskId);
  }

  /**
   * [2] 请求取消：abort 后 Planner 协作点会 throw。
   * @returns true 表示找到了运行中的 controller；false 表示任务已结束或不存在
   */
  abort(taskId: string, reason?: unknown): boolean {
    const controller = this.controllers.get(taskId);

    // 例：任务已 succeeded 再 POST cancel → false，HTTP 返回 cancelled:false
    if (!controller) {
      return false;
    }

    if (!controller.signal.aborted) {
      controller.abort(reason);
    }

    return true;
  }

  /** [4] 查询本进程是否仍登记该 task（cancel / 调试） */
  has(taskId: string): boolean {
    return this.controllers.has(taskId);
  }
}
