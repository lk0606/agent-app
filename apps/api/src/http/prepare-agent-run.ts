import type { RunAgentRequest } from "@agent-app/api-contract";
import { randomUUID } from "node:crypto";

import type { MemoryStore } from "../memory/memory-store.js";

/** /agent/run 与 /agent/stream 共用的 session + taskId 准备逻辑 */
export async function prepareAgentRun(
  memory: MemoryStore,
  agentRequest: RunAgentRequest,
): Promise<{ sessionId: string; taskId: string }> {
  let sessionId = agentRequest.sessionId ?? randomUUID();

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
