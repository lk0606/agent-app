# HTTP 请求体：`req` 上没有 `input`

## 一句话

`curl -d '{"input":"test"}'` 里的 JSON **在 HTTP body 流里**，不在 `req` 对象上；`readJsonBody(req)` 读流 → `JSON.parse` → 得到变量 `body`。

## 和 Express 的对比

| | Express | 本项目（原生 `node:http`） |
|--|---------|---------------------------|
| body 在哪 | `req.body`（`express.json()` 中间件挂上） | 无；要自己 `readJsonBody(req)` |
| 调试时 log `req` | 能看到 `req.body` | **看不到** `input` / `body` |

## HTTP 报文长什么样

```http
POST /agent/run HTTP/1.1
Host: localhost:3000
Content-Type: application/json
Content-Length: 16

{"input":"test"}
```

- `req.method` → `"POST"`
- `req.url` → `"/agent/run"`
- `req.headers` → `content-type`、`content-length` 等
- `{"input":"test"}` → **header 下面的 body 流**，默认不是 `req` 的属性

Node 的 `req` 类型是 `IncomingMessage`，本质是**可读流（Readable stream）**。

## 代码链路

```text
curl -d '{"input":"test"}'
  → TCP body 流
  → readJsonBody(req)          apps/api/src/http/http-request.ts
       for await (chunk of req)  读尽流
       JSON.parse(raw)           → body = { input: "test" }
  → parseSchema(RunAgentRequestSchema, body, ...)
       Zod 校验                  → agentRequest = { input: "test" }
  → prepareAgentRun(memory, agentRequest)
  → runner.run({ input: agentRequest.input, ... })
```

### `readJsonBody` 核心逻辑

```ts
for await (const chunk of req) {
  chunks.push(chunk);
}
const raw = Buffer.concat(chunks).toString("utf8");
return JSON.parse(raw);
```

注意：**流只能读一次**。`readJsonBody` 消费后，不能再次从 `req` 读 body。

### `parseSchema` 做什么

把 `body`（`unknown`）交给 `packages/api-contract` 里的 Zod schema，失败则抛 `AppError("BAD_REQUEST", ...)`，成功则得到类型化的 `RunAgentRequest`。

契约定义：

```ts
// packages/api-contract/src/schemas.ts
RunAgentRequestSchema = z.object({
  sessionId: z.string().optional(),
  taskId: z.string().optional(),
  input: z.string().trim().min(1),
}).strict();
```

## 调试时怎么 log

```ts
// ❌ 期望在 req 上看到 input —— 不会有
console.log(req);

// ✅ 读 body 之后
const body = await readJsonBody(req);
console.log("body", body); // { input: "test" }

const agentRequest = parseSchema(RunAgentRequestSchema, body, "Request body");
console.log("input", agentRequest.input); // "test"
```

断点建议：`http-request.ts` 的 `JSON.parse` 后，或 `server.ts` 的 `parseSchema` 后。

## 手测

```bash
curl -v -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"test"}'
```

在 `-d` 后面那段就是 body；对照 `readJsonBody` 读到的字符串。

## 相关文件

| 文件 | 职责 |
|------|------|
| `apps/api/src/server.ts` L48–54 | `/agent/run` 入口 |
| `apps/api/src/http/http-request.ts` | `readJsonBody` |
| `apps/api/src/http/validation.ts` | `parseSchema` |
| `packages/api-contract/src/schemas.ts` | `RunAgentRequestSchema` |

传错字段时的 400 响应见 [request-validation-errors.md](./request-validation-errors.md)。
