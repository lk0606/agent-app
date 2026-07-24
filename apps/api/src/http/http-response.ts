/** JSON 响应与 AppError → HTTP 状态码映射；所有路由共用 CORS 头 */
import type { ServerResponse } from "node:http";

import type { AppError } from "../shared/app-error.js";

/** 把 AppError.details 里的字段级说明透出到 HTTP JSON（契约 ErrorResponseSchema.details） */
export function buildErrorPayload(appError: AppError): {
  error: {
    code: AppError["code"];
    message: string;
    details?: string[];
  };
} {
  const payload: {
    code: AppError["code"];
    message: string;
    details?: string[];
  } = {
    code: appError.code,
    message: appError.message,
  };

  if (
    appError.details &&
    typeof appError.details === "object" &&
    "details" in appError.details &&
    Array.isArray(appError.details.details) &&
    appError.details.details.every((item) => typeof item === "string")
  ) {
    payload.details = appError.details.details;
  }

  return { error: payload };
}

export const HTTP_STATUS = {
  ok: 200,
  noContent: 204,
  badRequest: 400,
  notFound: 404,
  requestTimeout: 408,
  conflict: 409,
  internalServerError: 500,
} as const;

export function statusForError(code: AppError["code"]): number {
  switch (code) {
    case "BAD_REQUEST":
      return HTTP_STATUS.badRequest;
    case "NOT_FOUND":
      return HTTP_STATUS.notFound;
    case "TIMEOUT_ERROR":
      return HTTP_STATUS.requestTimeout;
    case "CANCELLED":
      return HTTP_STATUS.conflict;
    default:
      return HTTP_STATUS.internalServerError;
  }
}

export function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  });

  res.end(payload === null ? undefined : JSON.stringify(payload, null, 2));
}
