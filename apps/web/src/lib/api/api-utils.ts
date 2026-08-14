/** 前端 REST 共用：base URL、错误解析、JSON fetch（session-api / agent-api 复用） */
const DEFAULT_API_BASE_URL = "http://localhost:3000";

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_AGENT_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

/**
 * E.13：后端 API_AUTH_TOKEN 留空时后端不校验，这里返回 {} 即可正常联调；
 * 一旦后端配置了 token，前端也必须在 apps/web/.env.local 配 NEXT_PUBLIC_AGENT_API_TOKEN，否则全部请求 401。
 * 注意 NEXT_PUBLIC_* 会打进浏览器 bundle，不是真正的密钥保管方式——仅适合本地单人学习场景。
 */
export function getAuthHeaders(): Record<string, string> {
  const token = process.env.NEXT_PUBLIC_AGENT_API_TOKEN;

  if (!token) {
    return {};
  }

  return { authorization: `Bearer ${token}` };
}

export function readErrorMessage(payload: unknown): string {
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

  return "Request failed.";
}

export async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    throw new Error(readErrorMessage(payload));
  }

  return payload;
}
