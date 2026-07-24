/**
 * 从 .env 加载运行配置；缺 HUNYUAN_API_KEY / DATABASE_URL 时启动即失败。
 * 读 apps/api/.env.example 了解各变量含义。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  readFileRootDir: string;
  readFileMaxBytes: number;
  readFileAllowedExtensions: string[];
  readFileDeniedBasenames: string[];
  /** 与 read_file 共用 READ_FILE_ROOT_DIR；限制单次 listing 条数防输出过长 */
  listDirMaxEntries: number;
  /** search_docs 单次返回片段数；索引根目录同 READ_FILE_ROOT_DIR */
  searchDocsMaxResults: number;
  /** search_docs 切块最大字符数 */
  searchDocsChunkChars: number;
  /** search_docs 检索模式：keyword | vector | hybrid */
  searchDocsMode: "keyword" | "vector" | "hybrid";
  /** E.7-B embedding 模型；与 chat 共用 TokenHub baseURL */
  hunyuanEmbeddingModel: string;
  /** E.8：wait 工具最长等待秒数（手测取消用） */
  waitToolMaxSeconds: number;
  /**
   * E.8：单次任务默认超时（ms）。null = 不启用；
   * POST cancel / SSE 断开仍可取消。eval 可用单 case 的 taskTimeoutMs 覆盖。
   */
  agentTaskTimeoutMs: number | null;
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

  const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

  return {
    appName: process.env.APP_NAME ?? "agent-app",
    nodeEnv: process.env.NODE_ENV ?? "development",
    hunyuanApiKey,
    // 默认走 TokenHub；旧 api.hunyuan.cloud.tencent.com 的 turbos/t1 已下线，Key 也不通用
    hunyuanModel: process.env.HUNYUAN_MODEL ?? "hy3-preview",
    hunyuanBaseUrl: process.env.HUNYUAN_BASE_URL ?? "https://tokenhub.tencentmaas.com/v1",
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
    readFileRootDir: process.env.READ_FILE_ROOT_DIR ?? path.join(apiRoot, "evals/fixtures"),
    readFileMaxBytes: readNumber("READ_FILE_MAX_BYTES", 8192),
    readFileAllowedExtensions: readList("READ_FILE_ALLOWED_EXTENSIONS", ".txt,.md,.json,.yaml,.yml"),
    readFileDeniedBasenames: readList("READ_FILE_DENIED_BASENAMES", ".env,.env.local,credentials.json"),
    // list_dir 与 read_file 共用沙箱根目录，仅限制单次返回条目数
    listDirMaxEntries: readNumber("LIST_DIR_MAX_ENTRIES", 50),
    searchDocsMaxResults: readNumber("SEARCH_DOCS_MAX_RESULTS", 3),
    searchDocsChunkChars: readNumber("SEARCH_DOCS_CHUNK_CHARS", 500),
    searchDocsMode: readSearchDocsMode(process.env.SEARCH_DOCS_MODE),
    hunyuanEmbeddingModel: process.env.HUNYUAN_EMBEDDING_MODEL ?? "kinfra-text-embedding-0.6b",
    waitToolMaxSeconds: readNumber("WAIT_TOOL_MAX_SECONDS", 30),
    // 未设置或 0 = 不启用整任务超时（取消 API / 客户端断开仍有效）
    agentTaskTimeoutMs: readOptionalPositiveNumber("AGENT_TASK_TIMEOUT_MS"),
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

/** 未设置 / 空 / 0 / 非法 → null（表示关闭该可选能力） */
function readOptionalPositiveNumber(name: string): number | null {
  const value = process.env[name];

  if (!value) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
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

function readSearchDocsMode(value: string | undefined): AppConfig["searchDocsMode"] {
  if (value === "vector" || value === "hybrid" || value === "keyword") {
    return value;
  }

  return "keyword";
}
