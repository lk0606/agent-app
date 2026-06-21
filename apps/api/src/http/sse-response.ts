import type { ServerResponse } from "node:http";

const SSE_HEADERS = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
  "access-control-allow-origin": "*",
  "cache-control": "no-cache",
  connection: "keep-alive",
  "content-type": "text/event-stream; charset=utf-8",
} as const;

/** 开始 SSE 响应；后续用 writeSseEvent 推送 AgentStreamEvent（event 名 = type 字段） */
export function initSseResponse(res: ServerResponse): void {
  res.writeHead(200, SSE_HEADERS);
}

export function writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function endSseResponse(res: ServerResponse): void {
  res.end();
}
