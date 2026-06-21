import type { ServerResponse } from "node:http";
import type { Socket } from "node:net";

const SSE_HEADERS = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
  "access-control-allow-origin": "*",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "content-type": "text/event-stream; charset=utf-8",
  "x-accel-buffering": "no",
} as const;

/** 2KB SSE comment，绕过部分代理/缓冲层「攒够再发」的行为 */
const SSE_PADDING = `: ${" ".repeat(2048)}\n\n`;

/** 开始 SSE 响应；后续用 writeSseEvent 推送 AgentStreamEvent（event 名 = type 字段） */
export function initSseResponse(res: ServerResponse): void {
  res.writeHead(200, SSE_HEADERS);
  const socket = res.socket as Socket | null;
  socket?.setNoDelay(true);
  res.write(SSE_PADDING);
  flushSseResponse(res);
}

export function writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  flushSseResponse(res);
}

export function endSseResponse(res: ServerResponse): void {
  res.end();
}

/** 尽量立刻把 SSE 帧推到客户端，避免 Node/代理缓冲导致「一次性显示」 */
function flushSseResponse(res: ServerResponse): void {
  const flushable = res as ServerResponse & { flush?: () => void };
  flushable.flush?.();

  const socket = res.socket as (Socket & { uncork?: () => void }) | null;
  if (socket && !socket.destroyed) {
    socket.setNoDelay(true);
    socket.uncork?.();
  }
}
