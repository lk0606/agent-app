import {
  ArchiveSessionResponseSchema,
  GetSessionMessagesResponseSchema,
  GetSessionResponseSchema,
  GetTaskResponseSchema,
  ListSessionsResponseSchema,
  type ListSessionsQuery,
} from "@agent-app/api-contract";

import { fetchJson, getApiBaseUrl, getAuthHeaders } from "./api-utils";

/** Session / Task REST 封装；响应经 api-contract Zod parse，字段漂移时 TS 构建期报错 */
export async function listSessions(query: Partial<ListSessionsQuery> = {}) {
  const params = new URLSearchParams();

  if (query.status) {
    params.set("status", query.status);
  }

  if (query.limit) {
    params.set("limit", String(query.limit));
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const payload = await fetchJson(`${getApiBaseUrl()}/sessions${suffix}`, { headers: getAuthHeaders() });

  return ListSessionsResponseSchema.parse(payload);
}

export async function getSession(sessionId: string) {
  const payload = await fetchJson(`${getApiBaseUrl()}/sessions/${sessionId}`, { headers: getAuthHeaders() });

  return GetSessionResponseSchema.parse(payload);
}

export async function getSessionMessages(sessionId: string) {
  const payload = await fetchJson(`${getApiBaseUrl()}/sessions/${sessionId}/messages`, {
    headers: getAuthHeaders(),
  });

  return GetSessionMessagesResponseSchema.parse(payload);
}

export async function archiveSession(sessionId: string) {
  const payload = await fetchJson(`${getApiBaseUrl()}/sessions/${sessionId}/archive`, {
    method: "PATCH",
    headers: getAuthHeaders(),
  });

  return ArchiveSessionResponseSchema.parse(payload);
}

export async function getTask(taskId: string) {
  const payload = await fetchJson(`${getApiBaseUrl()}/tasks/${taskId}`, { headers: getAuthHeaders() });

  return GetTaskResponseSchema.parse(payload);
}
