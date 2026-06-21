import { AgentStreamEventSchema, type AgentStreamEvent } from "@agent-app/api-contract";

/** 从 fetch Response 解析 POST /agent/stream 的 SSE 帧 */
export async function readAgentStream(
  response: Response,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("Agent stream response has no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");

    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = parseSseData(block);

      if (data) {
        onEvent(AgentStreamEventSchema.parse(JSON.parse(data)));
      }

      boundary = buffer.indexOf("\n\n");
    }
  }
}

function parseSseData(block: string): string | null {
  const lines = block.split("\n");
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return dataLines.join("\n");
}
