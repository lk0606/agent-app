/**
 * HTTP 接口鉴权（E.13）：校验 `Authorization: Bearer <token>` 是否匹配 API_AUTH_TOKEN。
 *
 * 常规执行顺序（跨模块）：server.ts 每个非 /health 路由进来时先调 requireApiAuth，
 * 未配置 API_AUTH_TOKEN（expectedToken=null）时直接放行——仅限本地学习环境，
 * 生产/公网暴露前必须设置该变量（server.ts 启动时会 warn 一次提醒）。
 */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { AppError } from "../shared/app-error.js";

const BEARER_PREFIX = "Bearer ";

export function requireApiAuth(req: IncomingMessage, expectedToken: string | null): void {
  if (expectedToken === null) {
    return;
  }

  const header = req.headers.authorization;

  if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
    throw new AppError("UNAUTHORIZED", "Missing or malformed Authorization header. Expected: Bearer <token>.");
  }

  const providedToken = header.slice(BEARER_PREFIX.length);

  if (!safeTokenEquals(providedToken, expectedToken)) {
    throw new AppError("UNAUTHORIZED", "Invalid API token.");
  }
}

/** 定长安全比较：避免响应耗时暴露 token 前缀匹配长度；长度不同时不能直接喂进 timingSafeEqual，先短路判否 */
function safeTokenEquals(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
