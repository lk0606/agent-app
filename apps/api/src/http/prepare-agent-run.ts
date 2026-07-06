import type { RunAgentRequest } from "@agent-app/api-contract";
import { randomUUID } from "node:crypto";

import type { MemoryStore } from "../memory/memory-store.js";

/** /agent/run 与 /agent/stream 共用：确保 session 存在，并为本次请求分配 taskId */
export async function prepareAgentRun(
  memory: MemoryStore,
  agentRequest: RunAgentRequest,
): Promise<{ sessionId: string; taskId: string }> {
  let sessionId = agentRequest.sessionId ?? randomUUID();

  // 客户端未传 sessionId → 新建；传了但 DB 没有（首次或脏 id）→ 也创建占位行
  if (!agentRequest.sessionId) {
    await memory.createSession({ id: sessionId });
  } else {
    const session = await memory.getSession(sessionId);

    if (!session) {
      await memory.createSession({ id: sessionId });
    }
  }

  const taskId = agentRequest.taskId ?? randomUUID();

  return { sessionId, taskId };
}
