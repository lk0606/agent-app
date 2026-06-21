# Agent App Starter

面向 Node Agent 应用开发的学习型脚手架。

这个仓库同时包含两部分内容：

- 学习规划：帮助你从资深前端工程师平滑切到 Node Agent 应用开发。
- 项目骨架：提供一个可扩展的 TypeScript + Node Agent 分层结构。

## 目录

- `docs/current-status.md`：**当前进度与下一步（后端优先路线 + 每项测试方法；文首有阅读指南）**
- `docs/learning-plan.md`：渐进式学习成长计划
- `docs/project-scaffold-plan.md`：项目脚手架搭建计划
- `docs/persistence-model.md`：持久化模型设计
- `docs/postgres-setup.md`：本地 PostgreSQL 启动说明
- `docs/evals-and-replay.md`：评测与回放说明
- `docs/http-api.md`：后端 HTTP API 说明
- `docs/api-contract.md`：前后端共享 API 契约说明
- `docs/time-handling.md`：时间存储与前端展示规范
- `docs/session-context.md`：会话上下文窗口策略
- `docs/fullstack-frontend-plan.md`：前后端协同与 Next.js 前端规划
- `docs/web-setup.md`：Next.js 前端启动与测试说明
- `apps/api/src/`：Agent 后端骨架代码
- `apps/web/src/`：Next.js 前端工作台

## 当前脚手架能力

- `Agent` 抽象与 `PlannerAgent` 示例
- `Tool` 抽象与 `TimeTool`、`HttpFetchTool`、`EchoTool` 示例
- `MemoryStore` 抽象与内存版实现
- `TaskRunner` 运行时
- `HunyuanLlmClient` 实现，通过 OpenAI SDK 接腾讯混元兼容接口
- HTTP API：Agent 运行、会话列表、会话详情、消息时间线、任务详情
- Next.js 前端工作台：最小 chat 页面、主题切换、国际化路由、调试面板

## 快速开始

1. 安装依赖
2. 复制环境变量模板
3. 启动开发模式

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
pnpm install
pnpm run dev
```

在 `apps/api/.env` 中填入：

```bash
HUNYUAN_API_KEY=your_api_key
HUNYUAN_MODEL=hunyuan-turbos-latest
HUNYUAN_BASE_URL=https://api.hunyuan.cloud.tencent.com/v1
AGENT_MAX_STEPS=3
AGENT_TOOL_CALL_BUDGET=2
SESSION_HISTORY_MESSAGE_LIMIT=8
SESSION_HISTORY_CHAR_BUDGET=4000
HTTP_FETCH_TIMEOUT_MS=8000
HTTP_FETCH_RETRIES=2
HTTP_FETCH_MAX_CHARS=4000
HTTP_FETCH_MAX_RESPONSE_BYTES=12000
HTTP_FETCH_ALLOWED_CONTENT_TYPES=text/html,text/plain,application/json,application/xhtml+xml
HTTP_FETCH_ALLOW_HOSTS=
HTTP_FETCH_DENY_HOSTS=localhost,127.0.0.1,0.0.0.0
PORT=3000
DATABASE_URL=postgres://agent:agent@127.0.0.1:5432/agent_app
```

启动 HTTP 服务（**nodemon 热更新**：改 `apps/api/src` 或 `packages/api-contract` 后自动重启）：

```bash
pnpm run dev:server
```

仅单次启动、不监听文件变更：

```bash
pnpm --filter @agent-app/api dev:server:once
```

启动 Next.js 前端：

```bash
pnpm run dev:web
```

前端默认运行在 `http://localhost:3001/zh-CN`，后端默认运行在 `http://localhost:3000`。

调用示例：

```bash
curl -X POST http://localhost:3000/agent/run \
  -H "Content-Type: application/json" \
  -d '{"input":"请打开 https://cloud.tencent.com/document/product/1729/111007 并总结要点"}'
```

启动本地 PostgreSQL：

```bash
docker compose -f apps/api/infra/postgres/compose.yaml up -d
```

应用数据库迁移：

```bash
pnpm run db:migrate
```

运行评测：

```bash
pnpm run evals:run
```

回放任务：

```bash
pnpm run task:replay -- demo-task
```

## 推荐演进顺序

1. 先看 **`docs/current-status.md`**（当前进度与下一步）
2. 再看 `docs/learning-plan.md`
3. 再看 `docs/project-scaffold-plan.md`
4. 从 `apps/api/src/index.ts` 开始跑通主流程
5. 观察 `PlannerAgent -> HunyuanLlmClient -> Tool -> HunyuanLlmClient` 的执行链路
6. 逐步增加工具、记忆、任务编排、API 和评测能力
