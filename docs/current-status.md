# 当前进度与下一步

这是项目的**唯一进度状态源**。做完一项就更新一项，其他文档只保留设计细节，不再各自维护「已完成 / 下一步」。

最后更新：2026-06-03

## 30 秒阅读指南

把本文件当成项目「仪表盘」，**不必从头到尾通读**。

**每天开工前（必看）：**

1. 看 **[当前结论](#当前结论先看这里)** —— 今天该做什么、有没有阻塞
2. 看 **[§C 前端 Web](#c-前端-web按-step)** 里对应 Step 的表格 —— 找 `未开始` / `部分完成` 的行，那就是任务清单

**需要细节时再跳转：**

| 你想知道… | 去看 |
|-----------|------|
| 怎么启动、怎么手测 | `docs/web-setup.md` |
| API 字段与示例 | `docs/http-api.md` |
| Step 设计、技术选型 | `docs/fullstack-frontend-plan.md` |
| 目录、env、infra 在哪 | 本文件 [§A](#a-仓库结构monorepo) |
| 后端还能做什么 | 本文件 [§B](#b-后端-agent-能力) |
| 所有文档分工 | 本文件 [§F](#f-文档索引) |

**状态怎么读：**

| 状态 | 含义 |
|------|------|
| `已完成` | 验收通过，一般不用再动 |
| `部分完成` | 做了一部分，看表格里还缺哪几行 |
| `进行中` | 已开工、未验收（开工后可手动标上） |
| `未开始` | 还没做 |

**当前开发重点（2026-06-03）：** 盯住 §C 的 **Step 2**（会话 API 前端接入）和 **Step 4**（调试面板补全）。§A / §B / §D 是背景对照，不用每次开工都看。

---

## 怎么维护

每完成一个可验收项：

1. 在本文件对应条目把状态改为 `已完成` 或 `进行中`
2. 若是 Step 级任务，同步改 `docs/fullstack-frontend-plan.md` 里该 Step 的「状态」小节（一行引用即可）
3. 若涉及启动方式或目录变化，同步改 `README.md` 与相关 setup 文档
4. 更新本文件顶部的「最后更新」日期

状态取值：

| 状态 | 含义 |
|------|------|
| `已完成` | 验收通过，可长期使用 |
| `进行中` | 已开工但未验收 |
| `未开始` | 尚未动手 |
| `部分完成` | 核心能力有，但未达该条目全部验收 |

---

## 当前结论（先看这里）

**你现在最该做：** Step 2 的前端部分 —— 接入会话查询 API，把左栏做成真实 session 列表，并能恢复消息时间线。

**当前阻塞：** 无。后端 API 与共享契约已就绪，前端 API client 目前只有 `runAgent`。

---

## A. 仓库结构（monorepo）

| 项 | 状态 | 说明 |
|----|------|------|
| pnpm workspace（`apps/*` + `packages/*`） | 已完成 | `pnpm-workspace.yaml` |
| 后端迁至 `apps/api` | 已完成 | 源码在 `apps/api/src` |
| 前端 `apps/web` | 已完成 | Next.js App Router |
| 共享契约 `packages/api-contract` | 已完成 | Zod + TS 类型 |
| 根目录仅保留编排脚本 | 已完成 | `package.json` 转发到各 app |
| 后端 env 独立 | 已完成 | `apps/api/.env`（模板：`apps/api/.env.example`） |
| 前端 env 独立 | 已完成 | `apps/web/.env.local`（模板：`apps/web/.env.local.example`） |
| 后端 infra 独立 | 已完成 | `apps/api/infra/postgres` |
| 后端 evals 独立 | 已完成 | `apps/api/evals` |
| 根目录 `src/`、`infra/`、`evals/` | 已完成 | 已移除，不再使用 |

---

## B. 后端 Agent 能力

| 项 | 状态 | 说明 |
|----|------|------|
| PlannerAgent + 混元 LLM | 已完成 | |
| 工具：time / http_fetch / echo | 已完成 | |
| 工具安全治理 | 已完成 | 超时、重试、截断、内网拦截等 |
| PostgreSQL 持久化 | 已完成 | sessions / tasks / messages / tool_calls |
| 会话上下文（summary + recent window） | 已完成 | 见 `docs/session-context.md` |
| HTTP API 全套 | 已完成 | 见 `docs/http-api.md` |
| 评测 `pnpm run evals:run` | 已完成 | 见 `docs/evals-and-replay.md` |
| 回放 `pnpm run task:replay` | 已完成 | |
| Streaming endpoint | 未开始 | Step 5 |
| 更完整 task trace API | 未开始 | 供调试面板逐步还原决策链 |

---

## C. 前端 Web（按 Step）

主计划细节见 `docs/fullstack-frontend-plan.md` §6。

### Step 1：前端最小项目

| 验收项 | 状态 |
|--------|------|
| `apps/web` + Next.js + Tailwind | 已完成 |
| 最小 chat 页面 | 已完成 |
| 调 `POST /agent/run` | 已完成 |
| 复用 `sessionId` 连续追问 | 已完成 |
| 展示 toolCalls | 已完成 |
| 主题 light/dark/system | 已完成 |
| i18n 路由 `[locale]` | 已完成 |
| shadcn/ui 基础组件层 | 未开始 | 有意延后，见 `docs/web-setup.md` |

**Step 1 总状态：已完成**

### Step 2：会话查询（前后端）

| 验收项 | 状态 |
|--------|------|
| 后端 `GET /sessions` 等接口 | 已完成 |
| 前端 API client 封装会话/任务接口 | 未开始 |
| 左栏 session 列表 | 未开始 |
| 点击 session 恢复消息时间线 | 未开始 |
| summary preview | 未开始 |
| 归档 session | 未开始 |

**Step 2 总状态：部分完成**（后端完成，前端未接入）

### Step 3：共享 API contract

| 验收项 | 状态 |
|--------|------|
| `packages/api-contract` | 已完成 |
| 后端 request 校验 | 已完成 |
| 前端复用类型 + Zod parse | 部分完成 | 目前仅 `runAgent` 使用 contract |

**Step 3 总状态：已完成**（前端扩大使用范围属于 Step 2 一并做）

### Step 4：Agent 调试面板

| 验收项 | 状态 |
|--------|------|
| 展示 sessionId / taskId | 已完成 |
| 展示工具调用 | 已完成 |
| 展示 message timeline（服务端历史） | 未开始 |
| 展示 session summary | 未开始 |
| 展示 task status / error | 未开始 |
| 任务详情页 `/tasks/[taskId]` | 未开始 |

**Step 4 总状态：部分完成**

### Step 5：流式响应

| 验收项 | 状态 |
|--------|------|
| 后端 SSE / stream endpoint | 未开始 |
| 前端流式消息 UI | 未开始 |
| 工具调用过程实时展示 | 未开始 |

**Step 5 总状态：未开始**

---

## D. 脚手架里程碑（历史对照）

见 `docs/project-scaffold-plan.md`。

| 里程碑 | 状态 | 说明 |
|--------|------|------|
| M1 最小 Agent 可运行 | 已完成 | CLI + HTTP |
| M2 真实模型 + 多工具 | 已完成 | |
| M3 多步任务 + 状态跟踪 | 已完成 | TaskRunner + 持久化 |
| M4 HTTP API + 基础观测 | 已完成 | 日志 + eval + replay |

---

## E. 建议执行顺序（接下来 3 步）

1. **Step 2 前端接入**（P0）  
   - `apps/web/src/lib/api/` 补 session/task API  
   - 左栏 session 列表 + 切换恢复对话  
   - 验收：`docs/web-setup.md` 手测 + `pnpm run check:all`

2. **Step 4 调试面板补全**（P1）  
   - summary、task status/error、服务端 message timeline  
   - 可选路由：`/[locale]/tasks/[taskId]`

3. **文档随做随更**（并行）  
   - 每完成上表一行，回本文件改状态  
   - 大功能完成后补 `docs/web-setup.md` 手测步骤

Step 5（流式）等 Step 2/4 验收通过后再开。

---

## F. 文档索引

| 文档 | 用途 |
|------|------|
| **本文件** | 进度与下一步（状态源） |
| `docs/fullstack-frontend-plan.md` | 前后端技术选型与 Step 设计 |
| `docs/learning-plan.md` | 学习路线（偏个人成长） |
| `docs/project-scaffold-plan.md` | 后端分层与 M1–M4 |
| `docs/web-setup.md` | 前端启动与手测 |
| `docs/http-api.md` | 后端 API 参考 |
| `docs/api-contract.md` | 共享契约说明 |
| `docs/postgres-setup.md` | 本地数据库 |
| `docs/evals-and-replay.md` | 评测与回放 |
| `docs/session-context.md` | 会话记忆策略（设计参考） |
