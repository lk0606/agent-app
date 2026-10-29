# E.16 重试手测用例（每条独立可执行）

> 本文是 E.16 重试链路的**手测执行手册**。每条用例都是一个**完整、独立的命令块**：自带变量、自带请求、自带 `taskId` 提取和结果摘要，**不需要先运行任何“准备块”，也不依赖之前终端里的变量**。
> 进度与验收状态以 [`docs/current-status.md`](current-status.md) §E.16 为准；概念与公式见 [`docs/backend-learning/retry-notes.md`](backend-learning/retry-notes.md)。
> 手测只覆盖外部可观察行为；退避随机值、流式首片段后的重放边界等仍由 `test/e16-retry.test.ts` 与模拟服务保证（见 §5）。

## 0. 执行前确认

### 0.1 服务在跑

任意终端执行，返回 JSON 即正常：

```bash
curl -sS http://localhost:3000/health; echo
```

需要 PostgreSQL 已启动、`.env` 里有有效的 `HUNYUAN_API_KEY` 与 `DATABASE_URL`。E.16 没有新增表或字段，已有数据库不必重新迁移。

启动方式（需要时另开终端）：

```bash
cd /Users/lk/Documents/git/study/agent-app
pnpm run dev:server
```

### 0.2 每个块里的三个变量

所有用例块都以这一行开头，按需改：

```bash
BASE='http://localhost:3000'; TOKEN=''; SITE='https://httpbin.org'
```

- `BASE`：端口不是 3000 就改这里。
- `TOKEN`：未启用鉴权（`API_AUTH_TOKEN` 为空）时留空，该请求头会被忽略；启用了就必须填，否则全部 401。
- `SITE`：默认 `https://httpbin.org`；打不开改成 `'https://httpbingo.org'`，端点同名。

### 0.3 判读依据

| 位置 | 看什么 |
|------|--------|
| SSE 输出 | `thinking` → `planner_decision` → `tool_start` → `tool_end`（成功/失败）或 `error`；最后 `done` |
| 终端 A 日志 | `Tool execution retry scheduled` / `LLM request retry scheduled` 的条数，以及 `meta.attempt`、`meta.maxAttempts` |
| 块末摘要行 | `task=` 状态、`errorCode=`、`toolCalls=` 条数、`outcomes=` 规划结果 |

重试日志形如（终端 A）：

```json
{
  "level": "info",
  "scope": "agent",
  "message": "Tool execution retry scheduled",
  "meta": {
    "toolName": "http_fetch",
    "attempt": 1,
    "maxAttempts": 3,
    "delayMs": 37,
    "errorCode": "NETWORK_ERROR"
  },
  "taskId": "...",
  "time": "..."
}
```

LLM 链路把 `message` 换成 `LLM request retry scheduled`，`meta` 里是 `purpose`（`plan` / `answer` / `answer_stream` / `reflect` / `route` / `summarize`）、`attempt`、`maxAttempts`、`delayMs`、`reason`。

### 0.4 次数换算

- `maxRetries` 是**首次调用之外**的额外次数：`TOOL_MAX_RETRIES=2` ⇒ 最多 **3 次 attempt**、**2 条重试日志**。
- 本文预期按默认 `TOOL_MAX_RETRIES=2`、`LLM_MAX_RETRIES=2`；你的 `.env` 改过就按 `N+1` 换算。
- 退避是 full jitter（`[0, 上限)` 内随机），**`delayMs` 不要求递增或有固定值**，只数条数、看 `attempt`。

### 0.5 用例总览

| # | 场景 | 需改环境变量重启服务 | 期望摘要行 |
|---|------|----------------------|------------|
| 1 | `http_fetch` 200 成功 | 否 | `task=succeeded toolCalls=1` |
| 2 | 503 持续失败 | 否 | `task=failed errorCode=NETWORK_ERROR toolCalls=1` |
| 3 | 408 可重试 | 否 | 同 2 |
| 4 | 429 可重试 | 否 | 同 2 |
| 5 | 400 永久错误 | 否 | `task=failed errorCode=BAD_REQUEST toolCalls=1` |
| 6 | 404 永久错误 | 否 | 同 5 |
| 7 | 200 但内容类型被拦 | 否 | 同 5 |
| 8 | 内网 host 被拦 | 否 | 同 5 |
| 9 | `TOOL_MAX_RETRIES=0` 对照 | 是 | `task=failed errorCode=NETWORK_ERROR toolCalls=1`，0 条重试日志 |
| 10 | 单次请求超时 | 是 | `task=cancelled errorCode=TIMEOUT_ERROR toolCalls=0` |
| 11 | 请求进行中取消 | 是 | `task=cancelled errorCode=CANCELLED toolCalls=0` |
| 12 | LLM 瞬态错误重试 | 是 | `task=failed errorCode=LLM_ERROR toolCalls=0`，2 条 LLM 重试日志 |
| 13 | LLM 永久错误不重试 | 是 | 同 12，0 条重试日志 |
| 14 | `LLM_MAX_RETRIES=0` 对照 | 是 | 同 12，0 条重试日志 |

**共同前提**：用例 1–11 的 SSE 必须出现 `event: tool_start`。没有 `tool_start` 说明模型没选中工具，**该次不算验证**，重跑一次即可。

---

## 1. 免重启用例（直接复制即执行）

### 用例 1：200 正常成功

```bash
BASE='http://localhost:3000'; TOKEN=''; SITE='https://httpbin.org'
URL="$SITE/get"
curl -sS -o /dev/null -w 'upstream=%{http_code}\n' "$URL"

LOG=/tmp/e16-case01.log
INPUT="请务必调用 http_fetch 工具读取 $URL，不要只口头回答。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" | tee "$LOG"
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
echo "TASK_ID=$TASK_ID"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case01.json
node -e 'const r=require("/tmp/e16-case01.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：

- 第一行 `upstream=200`
- SSE 有 `tool_start` 和 `tool_end`（`"status":"succeeded"`），最后 `done`
- 终端 A **没有** `Tool execution retry scheduled`
- 摘要行：`task=succeeded errorCode=null toolCalls=1 outcomes=tool_executed|reflection_passed`（关闭 `AGENT_REFLECTION` 时 `outcomes=tool_executed`）

❌ 不正确：出现任何重试日志；`toolCalls` 不是 1；`task` 不是 `succeeded`。

### 用例 2：503 持续失败（核心）

```bash
BASE='http://localhost:3000'; TOKEN=''; SITE='https://httpbin.org'
URL="$SITE/status/503"
curl -sS -o /dev/null -w 'upstream=%{http_code}\n' "$URL"

LOG=/tmp/e16-case02.log
INPUT="请务必调用 http_fetch 工具读取 $URL，不要只口头回答。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" | tee "$LOG"
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
echo "TASK_ID=$TASK_ID"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case02.json
node -e 'const r=require("/tmp/e16-case02.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：

- `upstream=503`
- 终端 A **恰好 2 条** `Tool execution retry scheduled`，`toolName=http_fetch`，`attempt` 依次 1、2，`maxAttempts=3`，`errorCode=NETWORK_ERROR`
- 摘要行：`task=failed errorCode=NETWORK_ERROR toolCalls=1 outcomes=tool_failed`
- **3 次 HTTP 尝试只对应 1 条业务记录**

❌ 不正确：

- 重试日志 3 条以上，或出现 `attempt=3`
- `toolCalls=3`（把每次 attempt 当成一次业务调用）
- `errorCode=BAD_REQUEST`（把 5xx 当永久错误）

### 用例 3：408 可重试

```bash
BASE='http://localhost:3000'; TOKEN=''; SITE='https://httpbin.org'
URL="$SITE/status/408"
curl -sS -o /dev/null -w 'upstream=%{http_code}\n' "$URL"

LOG=/tmp/e16-case03.log
INPUT="请务必调用 http_fetch 工具读取 $URL，不要只口头回答。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" | tee "$LOG"
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
echo "TASK_ID=$TASK_ID"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case03.json
node -e 'const r=require("/tmp/e16-case03.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：`upstream=408`；2 条 Tool 重试日志；摘要行 `task=failed errorCode=NETWORK_ERROR toolCalls=1 outcomes=tool_failed`。

❌ 不正确：0 条重试日志（408 未被当作瞬态错误）。

### 用例 4：429 可重试

```bash
BASE='http://localhost:3000'; TOKEN=''; SITE='https://httpbin.org'
URL="$SITE/status/429"
curl -sS -o /dev/null -w 'upstream=%{http_code}\n' "$URL"

LOG=/tmp/e16-case04.log
INPUT="请务必调用 http_fetch 工具读取 $URL，不要只口头回答。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" | tee "$LOG"
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
echo "TASK_ID=$TASK_ID"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case04.json
node -e 'const r=require("/tmp/e16-case04.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：同用例 2。这里的 429 来自**目标站点**，会进入 `NETWORK_ERROR` 重试；Tool 层不解析 `Retry-After`，只做随机退避。

❌ 不正确：你看到的是本服务直接返回的 HTTP 429、SSE 根本没开始 → 那是 E.13 限流，不是本用例，等一分钟重跑。

### 用例 5：400 永久错误

```bash
BASE='http://localhost:3000'; TOKEN=''; SITE='https://httpbin.org'
URL="$SITE/status/400"
curl -sS -o /dev/null -w 'upstream=%{http_code}\n' "$URL"

LOG=/tmp/e16-case05.log
INPUT="请务必调用 http_fetch 工具读取 $URL，不要只口头回答。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" | tee "$LOG"
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
echo "TASK_ID=$TASK_ID"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case05.json
node -e 'const r=require("/tmp/e16-case05.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：`upstream=400`；**0 条** Tool 重试日志；摘要行 `task=failed errorCode=BAD_REQUEST toolCalls=1 outcomes=tool_failed`。

❌ 不正确：出现任何重试日志（400 被误判为可重试）。

### 用例 6：404 永久错误

```bash
BASE='http://localhost:3000'; TOKEN=''; SITE='https://httpbin.org'
URL="$SITE/status/404"
curl -sS -o /dev/null -w 'upstream=%{http_code}\n' "$URL"

LOG=/tmp/e16-case06.log
INPUT="请务必调用 http_fetch 工具读取 $URL，不要只口头回答。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" | tee "$LOG"
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
echo "TASK_ID=$TASK_ID"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case06.json
node -e 'const r=require("/tmp/e16-case06.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：`upstream=404`；0 条重试日志；摘要行 `task=failed errorCode=BAD_REQUEST toolCalls=1 outcomes=tool_failed`。

❌ 不正确：出现重试日志。

### 用例 7：200 但内容类型被拦

```bash
BASE='http://localhost:3000'; TOKEN=''; SITE='https://httpbin.org'
URL="$SITE/image/png"
curl -sS -o /dev/null -w 'upstream=%{http_code} %{content_type}\n' "$URL"

LOG=/tmp/e16-case07.log
INPUT="请务必调用 http_fetch 工具读取 $URL，不要只口头回答。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" | tee "$LOG"
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
echo "TASK_ID=$TASK_ID"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case07.json
node -e 'const r=require("/tmp/e16-case07.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：`upstream=200 image/png`；0 条重试日志；摘要行 `task=failed errorCode=BAD_REQUEST toolCalls=1 outcomes=tool_failed`。

❌ 不正确：`errorCode=NETWORK_ERROR` 或出现重试日志。若 `.env` 的 `HTTP_FETCH_ALLOWED_CONTENT_TYPES` 已包含 `image/png`，本用例不成立。

### 用例 8：内网 host 被拦

```bash
BASE='http://localhost:3000'; TOKEN=''

LOG=/tmp/e16-case08.log
INPUT="请务必调用 http_fetch 工具读取 http://127.0.0.1:3000 ，不要只口头回答。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" | tee "$LOG"
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
echo "TASK_ID=$TASK_ID"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case08.json
node -e 'const r=require("/tmp/e16-case08.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：0 条重试日志；摘要行 `task=failed errorCode=BAD_REQUEST toolCalls=1 outcomes=tool_failed`。拦截发生在 `fetch` 之前，不会真的发出请求。

❌ 不正确：出现重试日志或 `errorCode=NETWORK_ERROR`（说明请求已发出后连接失败，而不是被拦截）。

---

## 2. 需改环境变量重启的用例

每条的“终端 A”块都是完整命令：**先 `Ctrl+C` 停掉当前服务，再整段复制执行**。跑完再 `Ctrl+C`，用原命令启动恢复。

### 用例 9：关闭 Tool 重试对照

终端 A：

```bash
cd /Users/lk/Documents/git/study/agent-app
TOOL_MAX_RETRIES=0 pnpm run dev:server
```

终端 B：

```bash
BASE='http://localhost:3000'; TOKEN=''; SITE='https://httpbin.org'
URL="$SITE/status/503"
curl -sS -o /dev/null -w 'upstream=%{http_code}\n' "$URL"

LOG=/tmp/e16-case09.log
INPUT="请务必调用 http_fetch 工具读取 $URL，不要只口头回答。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" | tee "$LOG"
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
echo "TASK_ID=$TASK_ID"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case09.json
node -e 'const r=require("/tmp/e16-case09.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：**0 条**重试日志；摘要行 `task=failed errorCode=NETWORK_ERROR toolCalls=1 outcomes=tool_failed`。

❌ 不正确：仍出现 2 条重试日志（变量没生效；确认是真重启服务，而不是只改 `.env`）。

### 用例 10：单次请求超时（不进入网络重试）

终端 A：

```bash
cd /Users/lk/Documents/git/study/agent-app
HTTP_FETCH_TIMEOUT_MS=3000 pnpm run dev:server
```

终端 B：

```bash
BASE='http://localhost:3000'; TOKEN=''; SITE='https://httpbin.org'

LOG=/tmp/e16-case10.log
INPUT="请务必调用 http_fetch 工具读取 $SITE/delay/5 ，不要只口头回答。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" | tee "$LOG"
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
echo "TASK_ID=$TASK_ID"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case10.json
node -e 'const r=require("/tmp/e16-case10.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：

- SSE 有 `tool_start`，之后**没有** `tool_end`，直接 `event: error` 且 `"code":"TIMEOUT_ERROR"`
- 0 条 Tool 重试日志
- 摘要行 `task=cancelled errorCode=TIMEOUT_ERROR toolCalls=0 outcomes=`

❌ 不正确：`task=failed`（超时应落 `cancelled`）；出现重试日志（超时被当成网络错误重试）；`toolCalls=1`。

### 用例 11：请求进行中取消（不被当成网络错误重试）

终端 A：

```bash
cd /Users/lk/Documents/git/study/agent-app
HTTP_FETCH_TIMEOUT_MS=30000 pnpm run dev:server
```

终端 B（整段复制：先起流，等到 `tool_start` 再 cancel）：

```bash
BASE='http://localhost:3000'; TOKEN=''; SITE='https://httpbin.org'

LOG=/tmp/e16-case11.log
INPUT="请务必调用 http_fetch 工具读取 $SITE/delay/5 ，不要只口头回答。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" > "$LOG" &
CURL_PID=$!
for i in $(seq 1 20); do sleep 0.5; grep -q 'tool_start' "$LOG" && break; done
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
curl -sS -X POST -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID/cancel"; echo
wait $CURL_PID
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case11.json
node -e 'const r=require("/tmp/e16-case11.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：

- cancel 返回 `"cancelled": true`
- 0 条 Tool 重试日志
- 摘要行 `task=cancelled errorCode=CANCELLED toolCalls=0 outcomes=`

❌ 不正确：`"cancelled": false`（取消发晚了或模型没调工具，先 `grep tool_start /tmp/e16-case11.log`）；出现重试日志。

### 用例 12：LLM 瞬态错误重试

终端 A（`single` 保证只走 plan，日志计数干净）：

```bash
cd /Users/lk/Documents/git/study/agent-app
AGENT_ORCHESTRATION=single HUNYUAN_BASE_URL=http://127.0.0.1:9/v1 pnpm run dev:server
```

终端 B：

```bash
BASE='http://localhost:3000'; TOKEN=''

LOG=/tmp/e16-case12.log
INPUT="只回复「收到」。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" | tee "$LOG"
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
echo "TASK_ID=$TASK_ID"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case12.json
node -e 'const r=require("/tmp/e16-case12.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：终端 A **2 条** `LLM request retry scheduled`，`meta.purpose="plan"`，`attempt` 依次 1、2，`maxAttempts=3`；摘要行 `task=failed errorCode=LLM_ERROR toolCalls=0 outcomes=`。

❌ 不正确：只有 1 条或 0 条重试日志；`attempt` 超过 2；`errorCode` 不是 `LLM_ERROR`。

### 用例 13：LLM 永久错误不重试

终端 A：

```bash
cd /Users/lk/Documents/git/study/agent-app
AGENT_ORCHESTRATION=single LLM_MAX_RETRIES=2 HUNYUAN_MODEL=definitely-not-a-model pnpm run dev:server
```

终端 B：

```bash
BASE='http://localhost:3000'; TOKEN=''

LOG=/tmp/e16-case13.log
INPUT="只回复「收到」。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" | tee "$LOG"
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
echo "TASK_ID=$TASK_ID"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case13.json
node -e 'const r=require("/tmp/e16-case13.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：**0 条** `LLM request retry scheduled`；摘要行 `task=failed errorCode=LLM_ERROR toolCalls=0 outcomes=`。

❌ 不正确：出现重试日志（400/404 被误判为可重试）。若供应商对未知模型返回 5xx，本用例不成立，改用例 12/14 观察。

### 用例 14：关闭 LLM 重试对照

终端 A：

```bash
cd /Users/lk/Documents/git/study/agent-app
AGENT_ORCHESTRATION=single LLM_MAX_RETRIES=0 HUNYUAN_BASE_URL=http://127.0.0.1:9/v1 pnpm run dev:server
```

终端 B：

```bash
BASE='http://localhost:3000'; TOKEN=''

LOG=/tmp/e16-case14.log
INPUT="只回复「收到」。"
curl -N -sS -X POST "$BASE/agent/stream" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  --data "{\"input\":\"$INPUT\"}" | tee "$LOG"
TASK_ID=$(grep -o '"taskId":"[^"]*"' "$LOG" | head -1 | sed 's/.*"taskId":"//;s/"$//')
echo "TASK_ID=$TASK_ID"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/tasks/$TASK_ID" -o /tmp/e16-case14.json
node -e 'const r=require("/tmp/e16-case14.json");console.log("task="+(r.task&&r.task.status),"errorCode="+(r.task&&r.task.errorCode),"toolCalls="+(r.toolCalls||[]).length,"outcomes="+((r.plannerTrace||[]).map(s=>s.outcome).join("|")))'
```

✅ 正确：0 条 `LLM request retry scheduled`；摘要行 `task=failed errorCode=LLM_ERROR toolCalls=0 outcomes=`。

❌ 不正确：仍有 2 条重试日志（变量没生效）。

---

## 3. 通用判错速查

| 现象 | 说明 |
|------|------|
| 没有 `tool_start` | 模型没选工具，用例作废，重跑 |
| HTTP 401 | `TOKEN` 没填或填错 |
| 请求级 HTTP 429 | E.13 限流，不是被测重试 |
| `toolCalls` 条数 = 尝试次数 | 违反“一次逻辑调用一条业务记录” |
| 取消/超时落成 `failed` | 应为 `cancelled` |
| 成功请求出现重试日志 | 重试门槛过宽 |
| 400/404 出现重试日志 | 错误分类过宽 |

定位顺序：**SSE 有没有 `tool_start`** → **终端 A 的 `message` 与 `meta.attempt`** → **摘要行 `task/errorCode/toolCalls`** → `pnpm run task:replay -- "<taskId>"` 看库表。

---

## 4. `http_fetch` 的错误分类（对照用）

| 上游响应或故障 | Tool 抛出的错误码 | 是否自动重试 |
|----------------|-------------------|--------------|
| 200 + 白名单内 content-type | — | 成功，不重试 |
| 200 + 非白名单 content-type | `BAD_REQUEST` | 否 |
| 400 / 401 / 403 / 404 等 4xx（408、429 除外） | `BAD_REQUEST` | 否 |
| 408 / 429 / 5xx | `NETWORK_ERROR` | 是（默认最多 3 次 attempt） |
| DNS / 连接重置 / 连接拒绝等网络异常 | `NETWORK_ERROR` | 是 |
| 单次请求超时（`HTTP_FETCH_TIMEOUT_MS`） | `TIMEOUT_ERROR` | 否 |
| 任务取消（`AbortSignal`） | `CANCELLED` | 否 |
| 内网 host / 禁止 host / 缺少 URL | `BAD_REQUEST` | 否 |

只有 `idempotent=true` 的工具才可能重试；`write_file`、`wait`、`search_docs` 即使抛 `NETWORK_ERROR` 也只执行一次（这类边界靠模拟 Tool 的单测验证，不能靠“正常成功”的手测证明）。

---

## 5. 手测覆盖不到的边界

以下结论不能由上面的 curl 用例得出，需要单测或可控模拟服务：

- full jitter 的具体等待值、指数上限与 `maxDelayMs` 封顶（`pnpm run test` 的 `withRetry` 用例）
- `Retry-After` 的秒数/HTTP 日期解析，以及超过本地上限时的截断
- “503 → 200”的恢复序列：`http_fetch` 每次只发一个 GET，公网站点无法按请求序号返回不同响应
- 流式回答中**首个 token 已发给客户端后不再重放**（需要模拟流式模型；默认 `AGENT_REFLECTION=true` 时草稿可能与模型流不同源）
- 取消能否打断 **backoff sleep** 与**进行中的 embedding 请求**
- 一个逻辑调用内部多次 attempt 时，`tool_calls` / `planner_steps` 仍只增加一条的数据库级断言

对应命令：

```bash
pnpm run test
pnpm run check:all
pnpm run evals:run
```

`evals:run` 需要数据库与模型额度，全量执行耗时较长；本文用例是补充观察，不替代 eval 回归。
