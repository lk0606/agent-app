# HTTP API

这份文档记录当前后端给前端使用的最小 HTTP API。

## Health

```http
GET /health
```

返回：

```json
{
  "ok": true,
  "time": "2026-05-21T00:00:00.000Z"
}
```

## Run Agent

```http
POST /agent/run
```

请求：

```json
{
  "sessionId": "optional-existing-session-id",
  "input": "请记住：我喜欢东京。"
}
```

返回：

```json
{
  "sessionId": "...",
  "taskId": "...",
  "result": {
    "summary": "...",
    "toolCalls": []
  }
}
```

说明：

- 不传 `sessionId` 时，后端会自动创建一个 session。
- 传入已有 `sessionId` 时，会复用该 session 的上下文。

### 请求校验失败（400）

body 不是合法 JSON：

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Request body must be valid JSON."
  }
}
```

字段名或类型不符合 `RunAgentRequestSchema`（契约在 `packages/api-contract`）：

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Request body is invalid.",
    "details": [
      "input: Invalid input: expected string, received number"
    ]
  }
}
```

错字段名示例 `{"input1":"test"}` 还会在 `details` 里出现 `Unrecognized key: "input1"`（schema 使用 `.strict()`）。

手测与原理见 [`docs/backend-learning/request-validation-errors.md`](backend-learning/request-validation-errors.md)。

## List Sessions

```http
GET /sessions
GET /sessions?status=active&limit=20
```

返回：

```json
{
  "sessions": [
    {
      "id": "...",
      "title": null,
      "status": "active",
      "summary": "...",
      "lastTaskAt": "..."
    }
  ]
}
```

说明：

- `status` 可选：`active | archived`
- `limit` 可选，最大值为 `100`

## Get Session

```http
GET /sessions/:sessionId
```

返回：

```json
{
  "session": {
    "id": "...",
    "status": "active",
    "summary": "..."
  },
  "tasks": []
}
```

## Get Session Messages

```http
GET /sessions/:sessionId/messages
```

返回：

```json
{
  "sessionId": "...",
  "messages": [
    {
      "taskId": "...",
      "role": "user",
      "content": "...",
      "timestamp": "..."
    }
  ]
}
```

## Archive Session

```http
PATCH /sessions/:sessionId/archive
```

返回：

```json
{
  "session": {
    "id": "...",
    "status": "archived"
  }
}
```

## Get Task Detail

```http
GET /tasks/:taskId
```

返回：

```json
{
  "task": {
    "id": "...",
    "status": "succeeded",
    "summary": "..."
  },
  "messages": [],
  "toolCalls": [],
  "plannerTrace": [
    {
      "step": 1,
      "needsTool": true,
      "toolName": "time",
      "toolInput": "...",
      "outcome": "tool_executed",
      "errorCode": null,
      "errorMessage": null,
      "durationMs": 842
    }
  ]
}
```

`plannerTrace` 为 **Planner 决策链**（每轮 `llm.plan` 的结果），**不是** OpenTelemetry / 分布式链路里的 `traceId`。命名规则见 `docs/current-status.md` 【H 节】。

| 字段 | 含义 |
|------|------|
| `plannerTrace` | 模型每一步要不要工具、选哪个、耗时、outcome（来自 `planner_steps` 表） |
| `toolCalls` | 工具实际执行记录（来自 `tool_calls` 表） |

`plannerTrace` 主要字段：`step`、`needsTool`、`toolName`、耗时（`durationMs`）、错误（`errorCode` / `errorMessage`）、结果类型（`outcome`）。

`outcome` 取值：`direct_answer` | `tool_executed` | `tool_failed` | `budget_exceeded` | `duplicate_skipped` | `fallback_answer`。

这个接口主要给前端调试面板和任务回放详情使用。

`task.status` 取值：`pending` | `running` | `succeeded` | `failed` | **`cancelled`**（E.8：用户取消或超时中止，不是工具业务失败）。

## Cancel Task（E.8）

```http
POST /tasks/:taskId/cancel
```

对 **running** 任务发出 `AbortSignal`；Planner 在步进边界退出，最终 `tasks.status=cancelled`、`errorCode=CANCELLED`。

返回：

```json
{
  "taskId": "...",
  "cancelled": true,
  "status": "running"
}
```

| 字段 | 含义 |
|------|------|
| `cancelled` | `true` = 当时找到运行中 controller 并 abort；`false` = 任务已结束或不在本进程 |
| `status` | 发请求时读到的状态；最终以再 `GET /tasks/:id` 为准 |

说明：

- 客户端断开 `POST /agent/stream` 也会 abort（等价取消）。
- 整任务超时见 env `AGENT_TASK_TIMEOUT_MS`（未设则不启用）；错误码 `TIMEOUT_ERROR`，status 仍为 `cancelled`。
- 当前 LLM 调用为协作式取消：正在进行的一次 `llm.plan` 可能跑完才在下一步边界停下。

### curl 示例（推荐用 wait，不要用 time）

**不用开前端。** `taskId` 在 SSE **第一帧** `thinking` 的 JSON 里（服务端开流后立刻推）。

```bash
# 终端 A：长等待；一出现 thinking 就抄 data 里的 taskId
curl -N -X POST http://localhost:3000/agent/stream \
  -H 'content-type: application/json' \
  -d '{"input":"请务必调用 wait 工具等待 15 秒，结束后只回复完成"}'
```

你会先看到类似：

```text
event: thinking
data: {"type":"thinking","taskId":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx","step":1}
```

把 `taskId` 复制到终端 B（不要写字面量 `<taskId>`）：

```bash
curl -s -X POST http://localhost:3000/tasks/粘贴真实UUID/cancel | jq .
curl -s http://localhost:3000/tasks/粘贴真实UUID | jq '{status: .task.status, errorCode: .task.errorCode}'
```

更省事：终端 2 跑 `pnpm run smoke:cancel`（脚本自己从 SSE 读 taskId，不必手抄）。

## Stream Agent（SSE）

```http
POST /agent/stream
```

请求 body 与 `POST /agent/run` 相同（`RunAgentRequestSchema`）。

响应为 **`text/event-stream`**。每个 SSE 帧：

```text
event: thinking
data: {"type":"thinking","taskId":"...","step":1}
```

### 事件类型（`AgentStreamEvent`）

| type | 含义 |
|------|------|
| `thinking` | 开始一轮 `llm.plan` 或 `answerWithTool` |
| `planner_decision` | Planner 在 `plan()` 后的决策：`needsTool`、`toolName`、`toolInput` |
| `tool_start` | 即将执行工具 |
| `tool_end` | 工具结束（`status`: succeeded / failed；`toolOutput` 为完整输出） |
| `token` | 回答片段（混元 `stream: true` 真流式 delta；未 stream 时由服务端切片 fallback） |
| `done` | 任务成功结束，含 `sessionId`、`taskId`、`result` |
| `error` | 任务失败或取消/超时，含 `code`（如 `CANCELLED` / `TIMEOUT_ERROR`）、`message` |

命名见 `docs/current-status.md` 【H 节】：SSE 事件 **不是** OpenTelemetry `traceId`；落库决策链看 `plannerTrace`。

### curl 示例

```bash
curl -N -X POST http://localhost:3000/agent/stream \
  -H 'content-type: application/json' \
  -d '{"input":"请调用 time 工具，用一句话告诉我当前时间"}'
```

## Local Test

启动后端：

```bash
pnpm run dev:server
```

创建会话并运行一次 Agent：

```bash
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请记住：我喜欢东京。只回复收到。"}'
```

拿返回的 `sessionId` 和 `taskId` 继续测试：

```bash
curl -s http://localhost:3000/sessions
curl -s http://localhost:3000/sessions/{sessionId}
curl -s http://localhost:3000/sessions/{sessionId}/messages
curl -s http://localhost:3000/tasks/{taskId}
curl -s -X PATCH http://localhost:3000/sessions/{sessionId}/archive
```
