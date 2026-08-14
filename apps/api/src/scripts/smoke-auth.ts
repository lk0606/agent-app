/**
 * E.13 鉴权 + 限流手测脚本：只打 GET /sessions（不触发 LLM，零成本、跑得快）。
 * 用法：先 `pnpm run dev:server`（须设置 API_AUTH_TOKEN 才能测到 401 分支），另开终端：
 *   pnpm run smoke:auth
 *
 * 常规执行顺序（跨模块）：
 * 1. 无 Authorization 头请求 → 断言 401（除非 dev:server 未设 API_AUTH_TOKEN，此时应 200）
 * 2. 错误 token 请求 → 断言 401
 * 3. 正确 token 请求 → 断言 200
 * 4. 限流：连续打到超过 RATE_LIMIT_MAX_REQUESTS，断言第一个超限请求返回 429
 *
 * 本文件执行链路：见 main 内 [1]…[4]
 */
import "dotenv/config";

const baseUrl = process.env.SMOKE_API_BASE_URL ?? "http://127.0.0.1:3000";
const token = process.env.API_AUTH_TOKEN;
// 限流断言用的请求量：比 dev:server 实际配置的 RATE_LIMIT_MAX_REQUESTS 稍大，确保能打穿窗口
const rateLimitProbeCount = readNumberEnv("RATE_LIMIT_MAX_REQUESTS", 60) + 5;

async function main(): Promise<void> {
  console.log(`Probing auth + rate limit at ${baseUrl} ...`);

  if (!token) {
    // 未设置 API_AUTH_TOKEN：鉴权关闭是预期行为（学习环境默认），这里只提醒，不当失败处理
    console.log(
      "API_AUTH_TOKEN not set — auth is disabled by design (see config/env.ts). Skipping 401 assertions.",
    );

    const openRes = await fetch(`${baseUrl}/sessions`);
    assertStatus(openRes.status, 200, "GET /sessions without token (auth disabled)");
  } else {
    // [1] 无 Authorization 头 → 401
    const noAuthRes = await fetch(`${baseUrl}/sessions`);
    assertStatus(noAuthRes.status, 401, "GET /sessions without Authorization header");

    // [2] 错误 token → 401
    const wrongAuthRes = await fetch(`${baseUrl}/sessions`, {
      headers: { authorization: "Bearer wrong-token" },
    });
    assertStatus(wrongAuthRes.status, 401, "GET /sessions with wrong token");

    // [3] 正确 token → 200
    const okRes = await fetch(`${baseUrl}/sessions`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assertStatus(okRes.status, 200, "GET /sessions with correct token");
  }

  // [4] 限流：连续打满窗口，期望某次开始返回 429（用正确 token，避免和上面 401 断言混在一起数）
  console.log(`Firing ${rateLimitProbeCount} requests to probe rate limit ...`);
  const authHeaders: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  let sawRateLimited = false;

  for (let index = 0; index < rateLimitProbeCount; index += 1) {
    const response = await fetch(`${baseUrl}/sessions`, { headers: authHeaders });

    if (response.status === 429) {
      sawRateLimited = true;
      console.log(`Got 429 at request #${index + 1} (as expected once over the window limit).`);
      break;
    }
  }

  if (!sawRateLimited) {
    throw new Error(
      `Never saw 429 after ${rateLimitProbeCount} requests. Check RATE_LIMIT_MAX_REQUESTS on the running dev:server.`,
    );
  }

  console.log("smoke:auth passed.");
}

function assertStatus(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, got ${actual}`);
  }

  console.log(`OK: ${label} -> ${actual}`);
}

function readNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

main().catch((error: unknown) => {
  console.error("smoke:auth failed:", error);
  process.exitCode = 1;
});
