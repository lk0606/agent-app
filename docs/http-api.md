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
| `tool_start` | 即将执行工具 |
| `tool_end` | 工具结束（`status`: succeeded / failed） |
| `token` | 回答片段（当前为完整回答切片，非 LLM 原生流） |
| `done` | 任务成功结束，含 `sessionId`、`taskId`、`result` |
| `error` | 任务失败，含 `code`、`message` |

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
