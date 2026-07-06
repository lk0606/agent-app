/** 原生 http 模块的 JSON 请求体解析与路径工具（未使用 Express/Fastify） */
import type { IncomingMessage } from "node:http";

import { AppError } from "../shared/app-error.js";

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  if (raw.length === 0) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be valid JSON.");
  }
}

export function getPathSegments(requestUrl: URL): string[] {
  return requestUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent);
}

export function parsePositiveInt(value: string | null, options: { fallback: number; max?: number; name: string }): number {
  if (!value) {
    return options.fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError("BAD_REQUEST", `Query parameter "${options.name}" must be a positive integer.`);
  }

  return options.max ? Math.min(parsed, options.max) : parsed;
}
