# Fullstack Frontend Plan

这份文档记录 Agent 后端能力说明，以及 Next.js 前端的技术选型与 Step 设计。

**进度状态以 `docs/current-status.md` 为准**（做完一项更新一项）。本文 §6 的 Step 状态小节仅作摘要，详细验收与「下一步」请看该文件。

## 1. 当前后端做到哪一步

当前后端已经不是 demo，而是一个具备基础工程闭环的 Agent 服务原型。

已完成能力：

- 腾讯混元 OpenAI 兼容接口接入
- `PlannerAgent`：模型规划是否调用工具
- 工具体系：`time`、`http_fetch`、`echo`
- 工具安全治理：超时、重试、内容截断、内网拦截、allow/deny hosts、工具预算、重复调用保护
- PostgreSQL 持久化：`sessions`、`tasks`、`messages`、`tool_calls`
- 会话系统：同一个 `sessionId` 可以复用上下文
- 会话记忆：`summary + recent window`
- 持久化 session summary：`summary`、`summary_message_count`、`summary_updated_at`
- 共享 API contract：`packages/api-contract`
- 评测与回放：`evals:run`、`task:replay`
- HTTP API：`POST /agent/run`、**`POST /agent/stream`（SSE）**、`GET /sessions`、`GET /sessions/:sessionId`、`GET /sessions/:sessionId/messages`、`GET /tasks/:taskId`（含 **`plannerTrace`**）、`PATCH /sessions/:sessionId/archive`

当前后端后续：

- **E.3.5**：混元真 streaming、`planner_decision` SSE 事件、SSE flush（见 `docs/current-status.md` E.3.5）
- E.4：新工具 + eval 安全 case

## 2. 是否前后端放一个仓库

建议放一个仓库，采用 pnpm workspace monorepo。

原因：

- Agent 应用迭代很快，前端交互和后端能力经常一起变
- 可以共享 API 类型和 Zod schema
- 可以一条命令同时启动 web、api、db
- 评测、回放、UI 验证能在同一个项目里串起来
- 适合学习阶段形成“后端能力 -> 前端验证 -> eval 回归”的闭环

暂不建议前后端分仓。分仓更适合组织边界清晰、发布节奏不同、团队规模更大的阶段。

## 3. 推荐目录结构

长期目标结构：

```text
agent-app/
  apps/
    api/
      infra/
        postgres/
      evals/
        cases/
        reports/
      src/
      package.json
      tsconfig.json
    web/
      src/
        app/
          [locale]/
        components/
          ui/
          agent/
          layout/
          providers/
        features/
          chat/
          sessions/
          task-replay/
        lib/
          api/
          i18n/
          schemas/
          utils/
        locales/
          common/
          chat/
          sessions/
          debug/
        styles/
          themes.css
      public/
      package.json
      next.config.ts
  packages/
    api-contract/
      src/
        agent.ts
        session.ts
        task.ts
      package.json
    config/
      tsconfig/
      eslint/
  docs/
  package.json
  pnpm-workspace.yaml
```

第一阶段的保守迁移策略已经完成：

- 已新增 `apps/web`
- 后端已从根目录 `src/` 迁移到 `apps/api/src`
- 已新增 `packages/api-contract` 放共享类型和 schema

当前重点转向：在新目录结构上继续补齐会话页、任务回放页和流式能力。

## 4. 前端技术栈建议

### 框架

选择：

- Next.js App Router
- React
- TypeScript
- pnpm workspace

理由：

- App Router 是 Next.js 当前主线
- Server Components、Route Handlers、Streaming 能自然服务 Agent UI
- 未来可以把 Next.js 作为 BFF，也可以只作为纯前端调用 Node API

### UI 与样式

选择：

- Tailwind CSS
- shadcn/ui
- Radix UI
- lucide-react

理由：

- Tailwind 适合快速迭代界面，不容易被组件库主题锁死
- shadcn/ui 是“代码进项目”的方式，适合 Agent 产品快速改 UI
- Radix 提供底层可访问性和交互行为
- lucide-react 图标和 shadcn/ui 生态配合自然

使用原则：

- `apps/web/src/components/ui` 只放 shadcn 生成的基础组件
- `apps/web/src/components/agent` 放业务组件，比如消息气泡、工具调用卡片、plannerTrace 决策面板
- 不要一开始抽 `packages/ui`，除非后面真的有多个前端应用复用

### 状态与请求

第一阶段选择：

- `fetch` 封装一个轻量 API client
- React 本地状态管理 chat input、当前 session
- 暂不引入复杂全局 store

第二阶段再加：

- TanStack Query：管理 sessions、task replay、history 这类服务端状态
- Zustand：只管理 UI 本地状态，比如侧边栏开关、当前选中 session、调试面板状态

理由：

- TanStack Query 适合服务端状态缓存、刷新、失效
- Zustand 适合少量前端 UI 状态
- 不建议用 Zustand 管服务端数据，否则会自己重造缓存和同步逻辑

### 表单与校验

选择：

- Zod
- React Hook Form
- `@hookform/resolvers`

使用方式：

- 简单 chat 输入先不用 React Hook Form
- 设置页、工具配置页、eval case 编辑页再用 React Hook Form + Zod
- API contract 优先用 Zod schema 定义，请求响应类型从 schema 推导

### Agent UI 相关

第一阶段：

- 自己实现普通 chat UI
- 调 `POST /agent/run`
- 展示 `summary`、`toolCalls`、`sessionId`

第二阶段：

- 后端支持 streaming 后，再考虑接 Vercel AI SDK UI
- 重点使用 `useChat` 或 AI SDK stream protocol

原因：

- 当前后端还不是流式接口，过早引入 AI SDK 会增加适配成本
- 等后端支持 SSE/stream 后，AI SDK 的收益会更明显

### 主题定制与切换

Next.js 本身不提供完整主题系统。它提供的是应用结构、路由、服务端渲染能力；主题这件事需要我们在 UI 层设计。

推荐方案：

- Tailwind CSS
- shadcn/ui CSS variables
- `next-themes`
- 自定义 `ThemeProvider`
- 自定义 `ThemeToggle`

第一阶段支持：

- `light`
- `dark`
- `system`

设计原则：

- 颜色、圆角、边框、背景、强调色都走 CSS variables
- shadcn/ui 基础组件消费这些变量
- Agent 业务组件不要写死颜色，统一用 `bg-background`、`text-foreground`、`border-border`、`bg-muted` 这类 token
- 不要第一版就做多套品牌主题，先保证 light/dark/system 稳定

建议目录：

```text
apps/web/src/
  components/
    layout/
      theme-provider.tsx
      theme-toggle.tsx
  styles/
    globals.css
    themes.css
```

后续如果需要多主题，比如 `default`、`studio`、`terminal`，再扩展成：

```text
html[data-theme-preset="studio"] {
  --background: ...;
  --foreground: ...;
}
```

### 国际化

Next.js App Router 支持用动态路由段和 middleware 组织国际化路由，例如 `app/[locale]/...`。但它不等于自带完整翻译系统：文案字典、类型安全翻译、语言切换、消息格式化仍需要我们自己选方案。

推荐方案：

- 第一阶段先预留 `app/[locale]`
- 默认语言 `zh-CN`
- 第二语言预留 `en-US`
- 使用 `next-intl`
- 源码层使用“按业务模块拆分的 `message.ts`”，不使用“每种语言一个巨大 JSON”

原因：

- 比自己维护字典读取、middleware、类型更省心
- 适合 App Router
- 可以让 Server Components 读取对应 locale 的 message
- 后续做语言切换、日期数字格式化更顺

建议目录：

```text
apps/web/src/
  app/
    [locale]/
      layout.tsx
      page.tsx
  lib/
    i18n/
      routing.ts
      request.ts
      messages.ts
      pick-locale.ts
  locales/
    common/
      message.ts
    chat/
      message.ts
    sessions/
      message.ts
    debug/
      message.ts
```

第一阶段策略：

- 可以先只做 `zh-CN`
- 路由仍按 `[locale]` 规划
- UI 文案按业务模块集中到 `src/locales/**/message.ts`，不散落在组件里
- Agent 返回内容不翻译，它是模型输出；界面按钮、状态、错误信息才走 i18n

推荐 message 写法：

```ts
// src/locales/common/message.ts
export const commonMessages = {
  appName: {
    "zh-CN": "Agent 工作台",
    "en-US": "Agent Workbench",
  },
  actions: {
    send: {
      "zh-CN": "发送",
      "en-US": "Send",
    },
    retry: {
      "zh-CN": "重试",
      "en-US": "Retry",
    },
  },
} as const;
```

这个思路参考 `wont-org/biz-ui` 里 BizProvider/locales 的使用习惯：业务模块自己维护 message，应用入口通过 Provider 注入当前语言环境。我们不直接照搬实现，而是适配 Next.js App Router 和 `next-intl`。

然后在 `src/lib/i18n/messages.ts` 里按 locale 转换成 `next-intl` 需要的对象：

```ts
import { commonMessages } from "@/locales/common/message";
import { chatMessages } from "@/locales/chat/message";

export type AppLocale = "zh-CN" | "en-US";

export function getMessages(locale: AppLocale) {
  return {
    common: pickLocale(commonMessages, locale),
    chat: pickLocale(chatMessages, locale),
  };
}
```

`pickLocale` 的职责：

```ts
// 把 { send: { "zh-CN": "发送", "en-US": "Send" } }
// 转成当前 locale 下的 { send: "发送" }
export function pickLocale(messages, locale) {
  // 真实实现会递归处理嵌套对象，并在缺失语言时回退到默认语言。
}
```

这样有几个好处：

- 找文案时按业务找，比如 `chat/message.ts`、`sessions/message.ts`
- 新增一个按钮文案时，中英文放在一起，容易对照
- 运行时仍然给 `next-intl` 一个标准 messages object
- 后续可以加类型约束，保证每个 key 都有 `zh-CN` 和 `en-US`

如果觉得第一版加 `[locale]` 太影响速度，也可以先不改路由，但至少保留 `src/locales/**/message.ts` 和 `getMessages(locale)` 封装。长期看，前者更干净。

Provider 设计：

```text
apps/web/src/components/providers/
  app-provider.tsx
  theme-provider.tsx
  intl-provider.tsx
```

职责：

- `app-provider.tsx`：统一组合主题、国际化，后续再加入 TanStack Query
- `theme-provider.tsx`：封装 `next-themes`
- `intl-provider.tsx`：封装 `NextIntlClientProvider`

在 `app/[locale]/layout.tsx` 中使用：

```tsx
export default async function LocaleLayout({ children, params }) {
  const locale = params.locale;
  const messages = await getMessages(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <AppProvider locale={locale} messages={messages}>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
```

这样保留了 BizProvider 那种“入口统一注入上下文”的体验，同时不违背 Next.js App Router 的数据加载方式。

## 5. 前端第一版页面规划

第一版不要做复杂后台，先做一个可验证 Agent 能力的工作台。

页面：

- `/`：Agent Chat Workbench
- `/sessions`：会话列表
- `/sessions/[sessionId]`：会话详情
- `/tasks/[taskId]`：任务回放详情

第一屏重点：

- 左侧：session 列表
- 中间：对话区
- 右侧：调试面板

调试面板显示：

- 当前 `sessionId`
- 当前 `taskId`
- 工具调用列表
- session summary preview
- 最近消息窗口
- 错误信息

## 6. 前后端同步演进顺序

### Step 1：前端最小项目

- 新增 `apps/web`
- Next.js + TypeScript + Tailwind
- 接入 shadcn/ui
- 做一个最小 chat 页面
- 调现有 `POST /agent/run`

验收：

- 页面能输入问题
- 能收到后端 summary
- 能复用 `sessionId` 连续追问
- 能展示 toolCalls

状态：**已完成** — 详见 `docs/current-status.md` §C Step 1、`docs/web-setup.md`

### Step 2：后端补会话查询 API

- `GET /sessions`
- `GET /sessions/:sessionId`
- `GET /sessions/:sessionId/messages`
- `PATCH /sessions/:sessionId/archive`

验收：

- 前端左侧能展示 session 列表
- 点击 session 能恢复消息时间线
- 能看到 summary preview

状态：**部分完成** — 后端已完成，前端未接入；详见 `docs/current-status.md` §C Step 2（**当前 P0**）

### Step 3：共享 API contract

- 新增 `packages/api-contract`
- 用 Zod 定义请求响应 schema
- 后端校验 request body
- 前端复用类型和 schema

验收：

- 前后端类型不再手写两份
- API 改字段时 TypeScript 能提醒前端同步改

状态：**已完成** — 详见 `docs/current-status.md` §C Step 3、`docs/api-contract.md`

### Step 4：Agent 调试面板

- 展示工具调用
- 展示 message timeline
- 展示 session summary
- 展示 task status / error

验收：

- 一次请求为什么这样回答，前端能看出大概链路

状态：**部分完成** — sessionId/taskId/toolCalls 已有；timeline、summary、task error 待补；详见 `docs/current-status.md` §C Step 4

### Step 5：流式响应（E.3 通路 + E.3.5 完整体验）

**状态源：** `docs/current-status.md` 【C 节 Step 5】、【E 节 E.3 / E.3.5】。

#### E.3 已完成（通路）

- 后端 `POST /agent/stream`（SSE：`thinking` / `tool_start` / `tool_end` / `token` / `done` / `error`）
- 前端 `streamAgent` + 最小单气泡 UI

#### E.3.5 计划（Cursor 式 — 当前优先）

Agent 运行过程是**核心交互**，目标对齐 Cursor：知道正在做什么、调了什么工具、结果如何、回答如何流式呈现。

**后端（E.3.5-a / b）**

- 混元 `chat.completions.create({ stream: true })`，**真** `token` 推送（取代整段回答切片）
- 新增 SSE 事件 **`planner_decision`**：`step`、`needsTool`、`toolName`、`toolInput`
- SSE 写帧后及时 flush（避免事件堆在一帧）
- `emitTokenStream` 仅作无 stream API 时的 fallback

**前端（E.3.5-c / d / e）**

| 能力 | 方案 |
|------|------|
| **RunTimeline** | 一次 run = 时间线：规划 → 工具卡片 → 回答；替代单气泡 morphing |
| **工具卡片** | running / succeeded / failed；展示 input + output（可折叠）；inline 于对话流 |
| **Markdown** | `react-markdown` + `remark-gfm`；流式增长的 content 整段 re-parse |
| **动画** | 步骤入场、running 指示、完成/失败过渡、streaming 光标；Tailwind + 可选 `framer-motion`（仅 Timeline） |
| **可选 P1** | 代码高亮、复制按钮、`rehype-highlight` |

**组件规划（`apps/web/src/features/chat/`）**

```text
run-timeline.tsx       # 按 SSE 事件渲染步骤列表
tool-step-card.tsx     # 单工具步骤（running / done / error）
markdown-message.tsx   # 流式/最终回答 MD 渲染
agent-workbench.tsx    # 编排：用户消息 + RunTimeline
```

**验收**

- 调 `time`：时间线顺序可见「规划 → 调 time → output → 流式 MD 回答」
- 回答逐字/逐段可见（非一次性跳满）
- MD 列表、代码块、链接正常渲染
- 工具失败 inline 展示错误
- 跑完后仍可用 `taskId` + `plannerTrace` 调试

**依赖**

- 契约：`packages/api-contract/src/stream-events.ts` 扩展
- 不引入 Vercel AI SDK 作为 P0（可后续评估）；先用自有 SSE 协议

状态：**已完成**（E.3 通路 + E.3.5 RunTimeline / MD / 动画）

## 7. 第一阶段安装建议

从仓库根目录开始：

```bash
pnpm create next-app@latest apps/web --typescript --eslint --app --src-dir --tailwind --import-alias "@/*"
```

然后进入 web：

```bash
cd apps/web
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button textarea scroll-area separator badge card sheet tooltip
pnpm add lucide-react zod clsx tailwind-merge next-themes next-intl
```

第一阶段暂不安装：

- TanStack Query
- Zustand
- React Hook Form
- Vercel AI SDK
- ahooks

等页面超过“一个 chat workbench”后再加，不急。

## 8. 当前结论

推荐路线：

- 前后端同仓
- pnpm workspace
- `apps/web` 新增 Next.js 前端
- 后端之后迁移到 `apps/api`
- 共享契约放 `packages/api-contract`
- Chat 默认走 **`POST /agent/stream`**；RunTimeline + MD + 动画已按 **E.3.5** 交付
- UI 选择 Tailwind + shadcn/ui + Radix + lucide-react
- 主题选择 CSS variables + next-themes
- 国际化选择 Next.js `[locale]` 路由 + next-intl
- 国际化文案源码按业务模块放在 `src/locales/**/message.ts`，运行时聚合给 next-intl

这样最适合当前目标：快速迭代 Agent 能力，同时让前端能立刻验证后端每一步变化。
