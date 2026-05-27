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
  "toolCalls": []
}
```

这个接口主要给前端调试面板和任务回放详情使用。

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
