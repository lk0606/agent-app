import {
  RunAgentResponseSchema,
  type RunAgentRequest,
  type RunAgentResponse,
} from "@agent-app/api-contract";

const DEFAULT_API_BASE_URL = "http://localhost:3000";

export async function runAgent(input: RunAgentRequest): Promise<RunAgentResponse> {
  const response = await fetch(`${getApiBaseUrl()}/agent/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    throw new Error(readErrorMessage(payload));
  }

  return RunAgentResponseSchema.parse(payload);
}

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_AGENT_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

function readErrorMessage(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return "Agent request failed.";
}
