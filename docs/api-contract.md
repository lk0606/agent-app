# API Contract

`packages/api-contract` 是前后端共享的 API 契约包。

它当前负责三件事：

- 用 Zod 定义 HTTP 请求和响应 schema
- 从 schema 推导 TypeScript 类型
- 给后端提供运行时请求校验

## Package

```text
packages/api-contract/
  src/
    schemas.ts
    types.ts
    index.ts
  package.json
  tsconfig.json
```

## Current Schemas

当前已经覆盖：

- `RunAgentRequestSchema`
- `RunAgentResponseSchema`
- `ListSessionsQuerySchema`
- `ListSessionsResponseSchema`
- `GetSessionResponseSchema`
- `GetSessionMessagesResponseSchema`
- `ArchiveSessionResponseSchema`
- `GetTaskResponseSchema`
- `AgentStreamEventSchema`（`stream-events.ts`，SSE 用）
- `HealthResponseSchema`
- `ErrorResponseSchema`

## Backend Usage

后端现在已经在 `src/server.ts` 中使用 contract 校验：

- `POST /agent/run` 的 request body
- `GET /sessions` 的 query string

校验失败会统一转换成：

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Request body is invalid."
  }
}
```

## Frontend Usage

后续 Next.js 前端可以直接依赖：

```ts
import type { RunAgentRequest, RunAgentResponse } from "@agent-app/api-contract";
import { RunAgentResponseSchema } from "@agent-app/api-contract";
```

建议：

- 请求参数用类型约束
- 响应数据可以用 schema 做边界校验
- 前端不要再手写一套重复类型

## Scripts

根项目的 `check` 和 `build` 已经会先构建 contract：

```bash
pnpm run check
pnpm run build
```

也可以单独检查 contract：

```bash
pnpm --filter @agent-app/api-contract check
pnpm --filter @agent-app/api-contract build
```

## Design Notes

这一步先只把最核心的 HTTP contract 固化下来。

### Naming（与 `docs/current-status.md` 【H 节】一致）

- JSON / schema 字段：**camelCase**
- **禁止**用单独字段名 `trace` 表示 Agent 决策链 → 使用 **`plannerTrace`**
- 工具执行记录 → **`toolCalls`**（表 `tool_calls`）
- SSE 过程事件 → **`AgentStreamEvent.type`**（`thinking`、`tool_start`…），见 `stream-events.ts`
- 未来分布式链路 → **`traceId` / `spanId`**，与 `plannerTrace` / SSE 分开

后面如果 API 继续增多，可以再拆成：

```text
src/
  agent.ts
  session.ts
  task.ts
  common.ts
```

当前先保持一个 `schemas.ts`，避免过早拆分。
