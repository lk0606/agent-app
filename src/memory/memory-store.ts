export interface MemoryMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
}

export interface MemoryStore {
  append(taskId: string, message: MemoryMessage): Promise<void>;
  list(taskId: string): Promise<MemoryMessage[]>;
}
