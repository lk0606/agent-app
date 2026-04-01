import type { MemoryMessage, MemoryStore } from "./memory-store.js";

export class InMemoryStore implements MemoryStore {
  private readonly store = new Map<string, MemoryMessage[]>();

  async append(taskId: string, message: MemoryMessage): Promise<void> {
    const messages = this.store.get(taskId) ?? [];
    messages.push(message);
    this.store.set(taskId, messages);
  }

  async list(taskId: string): Promise<MemoryMessage[]> {
    return this.store.get(taskId) ?? [];
  }
}
