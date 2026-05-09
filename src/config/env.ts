export interface AppConfig {
  appName: string;
  nodeEnv: string;
  hunyuanApiKey: string;
  hunyuanModel: string;
  hunyuanBaseUrl: string;
  databaseUrl: string;
  agentMaxSteps: number;
  agentToolCallBudget: number;
  sessionHistoryMessageLimit: number;
  sessionHistoryCharBudget: number;
  httpFetchTimeoutMs: number;
  httpFetchRetries: number;
  httpFetchMaxChars: number;
  httpFetchMaxResponseBytes: number;
  httpFetchAllowedContentTypes: string[];
  httpFetchAllowHosts: string[];
  httpFetchDenyHosts: string[];
  port: number;
}

export function loadConfig(): AppConfig {
  const hunyuanApiKey = process.env.HUNYUAN_API_KEY;

  if (!hunyuanApiKey) {
    throw new Error("Missing HUNYUAN_API_KEY. Please set it in your environment or .env file.");
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL. Please set it in your environment or .env file.");
  }

  return {
    appName: process.env.APP_NAME ?? "agent-app",
    nodeEnv: process.env.NODE_ENV ?? "development",
    hunyuanApiKey,
    hunyuanModel: process.env.HUNYUAN_MODEL ?? "hunyuan-turbos-latest",
    hunyuanBaseUrl: process.env.HUNYUAN_BASE_URL ?? "https://api.hunyuan.cloud.tencent.com/v1",
    databaseUrl,
    agentMaxSteps: readNumber("AGENT_MAX_STEPS", 3),
    agentToolCallBudget: readNumber("AGENT_TOOL_CALL_BUDGET", 2),
    sessionHistoryMessageLimit: readNumber("SESSION_HISTORY_MESSAGE_LIMIT", 8),
    sessionHistoryCharBudget: readNumber("SESSION_HISTORY_CHAR_BUDGET", 4000),
    httpFetchTimeoutMs: readNumber("HTTP_FETCH_TIMEOUT_MS", 8000),
    httpFetchRetries: readNumber("HTTP_FETCH_RETRIES", 2),
    httpFetchMaxChars: readNumber("HTTP_FETCH_MAX_CHARS", 4000),
    httpFetchMaxResponseBytes: readNumber("HTTP_FETCH_MAX_RESPONSE_BYTES", 12000),
    httpFetchAllowedContentTypes: readList(
      "HTTP_FETCH_ALLOWED_CONTENT_TYPES",
      "text/html,text/plain,application/json,application/xhtml+xml",
    ),
    httpFetchAllowHosts: readList("HTTP_FETCH_ALLOW_HOSTS", ""),
    httpFetchDenyHosts: readList("HTTP_FETCH_DENY_HOSTS", "localhost,127.0.0.1,0.0.0.0"),
    port: readNumber("PORT", 3000),
  };
}

function readNumber(name: string, fallback: number): number {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function readList(name: string, fallback: string): string[] {
  const value = process.env[name] ?? fallback;

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
