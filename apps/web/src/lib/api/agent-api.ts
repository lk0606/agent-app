import {
  RunAgentResponseSchema,
  type AgentStreamEvent,
  type RunAgentRequest,
  type RunAgentResponse,
} from "@agent-app/api-contract";

import { fetchJson, getApiBaseUrl, readErrorMessage } from "./api-utils";
import { readAgentStream } from "./sse-client";

export async function runAgent(input: RunAgentRequest): Promise<RunAgentResponse> {
  const payload = await fetchJson(`${getApiBaseUrl()}/agent/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });

  return RunAgentResponseSchema.parse(payload);
}

/** SSE 流式跑 Agent；onEvent 按顺序收到 planner_decision / tool_* / token / done | error */
export async function streamAgent(
  input: RunAgentRequest,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/agent/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const payload = (await response.json()) as unknown;
    throw new Error(readErrorMessage(payload));
  }

  await readAgentStream(response, onEvent);
}
