# 请求校验错误（400 工程化）

## 目标

客户端传错 JSON 时，API 应返回**可操作的**错误，而不只是一句 `Request body is invalid.`。

## 响应形状（契约）

`packages/api-contract` → `ErrorResponseSchema`：

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Request body is invalid.",
    "details": [
      "input: Invalid input: expected string, received undefined",
      "root: Unrecognized key: \"input1\""
    ]
  }
}
```

- `message`：人类可读总述（固定模板）
- `details`：字段级说明数组（Zod `issues` 格式化而来）

## 链路

```text
readJsonBody(req)
  → JSON 语法错 → BAD_REQUEST "Request body must be valid JSON."（无 details）

parseSchema(RunAgentRequestSchema, body, "Request body")
  → Zod 失败 → AppError(BAD_REQUEST, "Request body is invalid.", { details: [...] })

server.ts catch
  → buildErrorPayload(appError)   apps/api/src/http/http-response.ts
  → writeJson(400, { error: { code, message, details? } })
```

`parseSchema` 把每条 Zod issue 格式化为 `"path: message"`：

```ts
// apps/api/src/http/validation.ts
`${path}: ${issue.message}`
```

## 手测：故意传错

### 错字段名 `input1`

```bash
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input1":"test"}' | jq .
```

**期望 `details` 含：**

- `input: ...`（缺少必填 `input`）
- `root: Unrecognized key: "input1"`（`RunAgentRequestSchema.strict()` 拒绝未知字段）

### 类型错误：数字而非字符串

```bash
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":111}' | jq .
```

**期望 `details` 含：**

```text
input: Invalid input: expected string, received number
```

### 正确请求（对照）

```bash
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"test"}' | jq .
```

## 为什么用 `.strict()`

默认 Zod `z.object()` 会**静默丢弃**未知 key。  
`{"input1":"test"}` 会变成 `{}`，你只能看到「缺 input」，看不到「多了 input1」。

对 **入参** schema 加 `.strict()` 后，未知字段进入 `details`，便于 curl / 前端快速定位拼写错误。

## 和日志的关系

服务端 `logger.error` 仍会打完整 `details`（仅服务端日志）。  
HTTP 响应里的 `details` 是给**调用方**（curl、前端、eval）用的，属于契约的一部分。

## 相关文件

| 文件 | 改动点 |
|------|--------|
| `packages/api-contract/src/schemas.ts` | `RunAgentRequestSchema.strict()`、`ErrorResponseSchema.details` |
| `apps/api/src/http/validation.ts` | Zod → `AppError` + `details` |
| `apps/api/src/http/http-response.ts` | `buildErrorPayload` |
| `apps/api/src/server.ts` | catch 里调用 `buildErrorPayload` |
| `docs/http-api.md` | 错误示例 |

## 前端对照

调试台 `fetch` 若 body 不符合契约，会收到同样结构的 400；可在网络面板看 `error.details`，不必猜是字段名还是类型问题。
