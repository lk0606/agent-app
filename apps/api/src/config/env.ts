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
  /**
   * E.9：估算成本单价（USD / 百万 token）。仅学习对照，非 TokenHub 真实账单。
   * 未配置时用占位默认值，保证 metrics.estimatedCostUsd 始终可算。
   */
  llmPricePromptPer1MUsd: number;
  llmPriceCompletionPer1MUsd: number;
  /**
 * E.10：危险工具跳过人工挂起、立刻 approve。
   * HTTP server 默认 false；evals:run 脚本会强制 true，避免挂死。
   */
  confirmationAutoApprove: boolean;
  /**
   * E.12：编排模式。
   * - supervisor：先路由专家再跑 Planner（工具子集）
   * - single：直接 Planner + 全量工具（与 E.11 前行为一致，便于对比/救急）
   */
  agentOrchestration: "supervisor" | "single";
  /**
   * E.14：外部工具输出进 LLM prompt 前是否加隔离包装。
   * 默认 true；设 false 可裸拼对照验证（同模型同 fixture 应更容易中招）。
   */
  promptInjectionGuard: boolean;
  /**
   * E.14 学习期观测：打印「工具原文 → 隔离包装后」的前后形态（含 BEGIN/END 头尾）。
   * 默认 false；只影响日志，不改 prompt 内容。日志较长，别在压测/长文档时开。
   */
  promptInjectionGuardDebug: boolean;
  port: number;
  /**
   * E.13：HTTP 接口鉴权 token；null = 未设置，鉴权关闭（仅限本地学习环境，server.ts 启动时会 warn 提醒）。
   * 与 HUNYUAN_API_KEY 无关——这是保护本服务对外接口，不是调上游 LLM 的凭证。
   */
  apiAuthToken: string | null;
  /** E.13：限流窗口（ms）与窗口内最大请求数，按客户端 IP 计数；健康检查 /health 不计入 */
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
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
    // 学习期按能力排序倒序试用免费额度；MiniMax M2.5 支持 Function Calling，兼容处理见 HunyuanLlmClient。
    hunyuanModel: process.env.HUNYUAN_MODEL ?? "minimax-m2.5",
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
    // E.9：占位单价；改 env 即可对照「贵在 prompt 还是 completion」
    llmPricePromptPer1MUsd: readNonNegativeNumber("LLM_PRICE_PROMPT_PER_1M_USD", 0.5),
    llmPriceCompletionPer1MUsd: readNonNegativeNumber("LLM_PRICE_COMPLETION_PER_1M_USD", 1.5),
    // E.10：仅显式开启时自动批准；dev:server 手测确认须保持 false
    confirmationAutoApprove: readBoolean("CONFIRMATION_AUTO_APPROVE", false),
    // E.12：默认走 Supervisor；设 single 可对比单 Agent / 救急绕过路由
    agentOrchestration: readAgentOrchestration(process.env.AGENT_ORCHESTRATION),
    // E.14：默认开启隔离包装；false 时工具输出裸拼进 prompt，便于 A/B 中招对照
    promptInjectionGuard: readBoolean("PROMPT_INJECTION_GUARD", true),
    // 学习期才开：日志里能看到包装前后两段文本，确认「什么时候转、转成什么」
    promptInjectionGuardDebug: readBoolean("PROMPT_INJECTION_GUARD_DEBUG", false),
    port: readNumber("PORT", 3000),
    // E.13：未设置 = 空字符串/undefined 都视为「关闭鉴权」，与 agentTaskTimeoutMs 的「未配置=关闭」同一约定
    apiAuthToken: process.env.API_AUTH_TOKEN?.trim() ? process.env.API_AUTH_TOKEN.trim() : null,
    rateLimitWindowMs: readNumber("RATE_LIMIT_WINDOW_MS", 60_000),
    rateLimitMaxRequests: readNumber("RATE_LIMIT_MAX_REQUESTS", 60),
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

/** 允许 0（免费模型学习场景）；负数 / NaN 回退默认 */
function readNonNegativeNumber(name: string, fallback: number): number {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
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

/** 非法 / 空 → supervisor（E.12 默认）；仅显式 single 关闭多 Agent */
function readAgentOrchestration(value: string | undefined): AppConfig["agentOrchestration"] {
  if (value === "single" || value === "supervisor") {
    return value;
  }

  return "supervisor";
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  // 未设 / 空串 → 默认；CONFIRMATION_AUTO_APPROVE 手测须保持 false（空）
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  // 接受 1/true/yes 与 0/false/no；其它脏值回退默认，避免拼写错误静默变 true
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }

  return fallback;
}
