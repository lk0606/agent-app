# Web Setup

这份文档记录 Next.js 前端的启动、配置和自测方式。前端当前定位是 Agent Workbench：用真实 UI 快速验证后端的 session、task、tool calls。

## 当前技术栈

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- `next-intl`：国际化 Provider 与消息注入
- `next-themes`：`light`、`dark`、`system` 主题切换
- `lucide-react`：图标
- `@agent-app/api-contract`：前后端共享 Zod schema 和 TypeScript 类型

## 启动方式

先启动数据库和后端：

```bash
docker compose -f apps/api/infra/postgres/compose.yaml up -d
pnpm run db:migrate
pnpm run dev:server
```

再开一个终端启动前端：

```bash
pnpm run dev:web
```

访问：

```text
http://localhost:3001/zh-CN
```

如果后端地址不是默认的 `http://localhost:3000`，可以在 `apps/web/.env.local` 中配置：

```bash
NEXT_PUBLIC_AGENT_API_BASE_URL=http://localhost:3000
```

## 怎么测

1. 打开 `http://localhost:3001/zh-CN`。
2. 输入 `请记住：我喜欢东京。`，确认页面能收到 assistant summary。
3. 观察右侧调试面板，确认出现 `sessionId` 和 `taskId`。
4. 继续输入 `我刚才说我喜欢哪里？`，确认后端能复用同一个 session 的上下文。
5. 输入 `请调用 time 工具告诉我当前时间。`，确认页面能展示工具调用信息。
6. 如果某条消息发送失败，消息旁边会出现红色感叹号，点击感叹号或气泡里的 `重发` 可以用原内容再请求一次。
7. 在输入框里按 `Enter` 应该直接发送，按 `Shift+Enter` 应该保留换行。
8. 在 13 寸 MacBook Air 这类小屏上，页面外层不应该出现纵向滚动条；只有中间对话消息区需要在消息变多时内部滚动。

## 常见问题

### 页面提示无法连接后端

先确认启动的是 HTTP 服务：

```bash
pnpm run dev:server
```

不要用下面这个命令联调前端：

```bash
pnpm run dev
```

`pnpm run dev` 运行的是命令行 demo，会执行一次内置任务并打印日志，但不会监听 `http://localhost:3000/agent/run`，所以前端会显示请求失败。

## 质量检查

前端单独检查：

```bash
pnpm --filter @agent-app/web lint
pnpm --filter @agent-app/web build
```

前后端一起检查：

```bash
pnpm run check:all
```

## 目录约定

- `apps/web/src/app/[locale]`：国际化路由入口
- `apps/web/src/features/chat`：Agent 工作台页面
- `apps/web/src/lib/api`：前端 API client
- `apps/web/src/lib/i18n`：locale、message 聚合和 next-intl 配置
- `apps/web/src/locales/**/message.ts`：按业务模块维护文案
- `apps/web/src/components/providers`：应用级 Provider 组合

## 当前边界

第一版暂时只做普通请求，不做 streaming。等后端增加 SSE 或 AI SDK stream-compatible endpoint 后，再升级成流式消息展示。

`shadcn/ui` 暂时没有通过 CLI 初始化。当前页面先用 Tailwind 和少量业务组件跑通闭环；等按钮、输入框、弹窗、侧栏开始多处复用时，再把 `components/ui` 作为稳定基础组件层引入。
