import type { ServerResponse } from "node:http";

import type { AppError } from "../shared/app-error.js";

export const HTTP_STATUS = {
  ok: 200,
  noContent: 204,
  badRequest: 400,
  notFound: 404,
  internalServerError: 500,
} as const;

export function statusForError(code: AppError["code"]): number {
  switch (code) {
    case "BAD_REQUEST":
      return HTTP_STATUS.badRequest;
    case "NOT_FOUND":
      return HTTP_STATUS.notFound;
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
