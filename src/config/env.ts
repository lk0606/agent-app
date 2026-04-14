export interface AppConfig {
  appName: string;
  nodeEnv: string;
  hunyuanApiKey: string;
  hunyuanModel: string;
  hunyuanBaseUrl: string;
  agentMaxSteps: number;
  httpFetchTimeoutMs: number;
  httpFetchRetries: number;
  httpFetchMaxChars: number;
  port: number;
}

export function loadConfig(): AppConfig {
  const hunyuanApiKey = process.env.HUNYUAN_API_KEY;

  if (!hunyuanApiKey) {
    throw new Error("Missing HUNYUAN_API_KEY. Please set it in your environment or .env file.");
  }

  return {
    appName: process.env.APP_NAME ?? "agent-app",
    nodeEnv: process.env.NODE_ENV ?? "development",
    hunyuanApiKey,
    hunyuanModel: process.env.HUNYUAN_MODEL ?? "hunyuan-turbos-latest",
    hunyuanBaseUrl: process.env.HUNYUAN_BASE_URL ?? "https://api.hunyuan.cloud.tencent.com/v1",
    agentMaxSteps: readNumber("AGENT_MAX_STEPS", 3),
    httpFetchTimeoutMs: readNumber("HTTP_FETCH_TIMEOUT_MS", 8000),
    httpFetchRetries: readNumber("HTTP_FETCH_RETRIES", 2),
    httpFetchMaxChars: readNumber("HTTP_FETCH_MAX_CHARS", 4000),
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
