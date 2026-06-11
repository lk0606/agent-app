# 当前进度与下一步

这是项目的**唯一进度状态源**。做完一项就更新一项，其他文档只保留设计细节，不再各自维护「已完成 / 下一步」。

最后更新：2026-06-03（采用后端优先路线）

## 30 秒阅读指南

把本文件当成项目「仪表盘」，**不必从头到尾通读**。

**每天开工前（必看）：**

1. 看 **[当前结论](#当前结论先看这里)** —— 今天该做什么、有没有阻塞
2. 看 **[【E 节】后端优先路线](#e-后端优先路线当前采用)** —— 后端学习任务 + 每项的测试方法
3. 前端任务看 **[【C 节】前端 Web](#c-前端-web按-step)**（当前搁置，SSE 阶段除外）

**需要细节时再跳转：**

| 你想知道… | 去看 |
|-----------|------|
| 怎么启动、怎么手测 | `docs/web-setup.md` |
| API 字段与示例 | `docs/http-api.md` |
| Step 设计、技术选型 | `docs/fullstack-frontend-plan.md` |
| 目录、env、infra 在哪 | 本文件 [【A 节】仓库结构](#a-仓库结构monorepo) |
| 后端还能做什么 | 本文件 [【B 节】后端能力](#b-后端-agent-能力) |
| eval 是什么 | 本文件 [术语：eval](#术语eval-是什么) |
| 后端任务怎么测 | 本文件 [【E 节】](#e-后端优先路线当前采用) 每项下的「测试方法」 |
| 所有文档分工 | 本文件 [【G 节】文档索引](#g-文档索引) |

**状态怎么读：**

| 状态 | 含义 |
|------|------|
| `已完成` | 验收通过，一般不用再动 |
| `部分完成` | 做了一部分，看表格里还缺哪几行 |
| `进行中` | 已开工、未验收（开工后可手动标上） |
| `未开始` | 还没做 |

**当前开发重点（后端优先）：** 见 [【E 节】](#e-后端优先路线当前采用) —— 当前 P0 是 **扩展 eval 回归基线**。前端 Step 2/4 暂缓；**SSE 阶段必须接最小前端**才能看流式效果。

---

## 怎么维护

每完成一个可验收项：

1. 在本文件对应条目把状态改为 `已完成` 或 `进行中`
2. **在【E 节】对应任务下补充或更新「测试方法」**（见下方约定）
3. 若是 Step 级任务，同步改 `docs/fullstack-frontend-plan.md` 里该 Step 的「状态」小节（一行引用即可）
4. 若涉及启动方式或目录变化，同步改 `README.md` 与相关 setup 文档
5. 更新本文件顶部的「最后更新」日期

### 任务完成后的测试方法（固定约定）

每做完一项后端（或需要联调的前端）任务，**必须**在【E 节】写下可复制的验证步骤，至少包含：

- 启动依赖（db / server / web）
- 一条或多条可执行命令（`curl`、`pnpm run …`）
- 预期结果（返回字段、日志、eval 通过率、UI 现象）
- 失败时怎么排查（看哪张表、哪条日志、`task:replay` 用哪个 id）

开发时由 AI/协作者交付任务时一并给出测试方法；合并前进文档写回【E 节】。

状态取值：

| 状态 | 含义 |
|------|------|
| `已完成` | 验收通过，可长期使用 |
| `进行中` | 已开工但未验收 |
| `未开始` | 尚未动手 |
| `部分完成` | 核心能力有，但未达该条目全部验收 |

---

## 当前结论（先看这里）

**路线：** 后端优先学习（见【E 节】）。现有 chat 前端够用，日常用 `curl` + `evals:run` + `task:replay` 验证即可。

**你现在最该做（P0）：** 扩展 `apps/api/evals/cases/`，把 eval 变成「改后端必跑」的回归基线。

**当前阻塞：** 无。

**前端何时再动：**

| 阶段 | 前端是否要做 |
|------|----------------|
| eval / trace API / 新工具 | 不需要 |
| **SSE 流式（Step 5）** | **需要** —— 至少接最小流式 UI，否则看不到生成过程 |
| session 列表 / 完整调试面板 | 可选，不阻塞后端学习 |

### 术语：eval 是什么

**不完全是「测试报告」**，而是两层东西：

| 概念 | 是什么 | 在哪 |
|------|--------|------|
| **eval 用例** | 一组预设的 Agent 任务 + 期望结果（该调哪个工具、回答里要有啥词等） | `apps/api/evals/cases/*.json` |
| **eval 报告** | 跑完用例后生成的结果文件（通过/失败、失败原因） | `apps/api/evals/reports/eval-run-*.json` |

运行命令：`pnpm run evals:run`  
作用：改 prompt、工具、模型后**自动回归**，不用每次手动 curl 猜对不对。  
和单元测试类似，但测的是 **Agent 端到端行为**（工具选择、回答质量等）。

失败排查：看报告里的 `taskId`，再跑 `pnpm run task:replay -- <taskId>`。

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

主计划细节见 `docs/fullstack-frontend-plan.md` 第 6 节。

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

## E. 后端优先路线（当前采用）

> 对齐 `docs/learning-plan.md` 第 5–8 周：多步任务、评测、API 服务化、流式。  
> 全栈路线（Step 2/4 前端大改）见 [【F 节】全栈路线（备选）](#f-全栈路线备选)。

### E.1 扩展 eval 回归基线

| | |
|--|--|
| **状态** | 未开始 |
| **目标** | 多补 eval case，覆盖会话记忆、工具命中、失败任务、工具预算 |
| **改动范围** | `apps/api/evals/cases/`、`apps/api/src/scripts/run-evals.ts`（如需） |

**测试方法：**

```bash
docker compose -f apps/api/infra/postgres/compose.yaml up -d
pnpm run db:migrate
pnpm run evals:run
```

- 预期：`evals/reports/eval-run-*.json` 生成，失败数为 0（或新增 case 按设计应 fail）
- 改 `PlannerAgent` / 工具后重跑，确认回归能抓住行为变化
- 某条失败：用报告里的 `taskId` 执行 `pnpm run task:replay -- <taskId>`

---

### E.2 Task trace API（Planner 决策链）

| | |
|--|--|
| **状态** | 未开始 |
| **目标** | `GET /tasks/:taskId` 能还原每一步：step、needsTool、toolName、耗时、错误 |
| **改动范围** | `TaskRunner`、`PlannerAgent` 落库或扩展响应、`packages/api-contract` |

**测试方法：**

```bash
pnpm run dev:server
# 触发一次带工具调用的任务
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请调用 time 工具告诉我当前时间"}' | jq .
# 用返回的 taskId
curl -s http://localhost:3000/tasks/<taskId> | jq .
pnpm run task:replay -- <taskId>
```

- 预期：响应含完整 messages + toolCalls；trace 字段能解释「为何调用了 time」
- 失败：查 `tasks` / `tool_calls` 表，`pnpm run db:inspect`

---

### E.3 Streaming endpoint（SSE）

| | |
|--|--|
| **状态** | 未开始 |
| **目标** | 后端推送 `thinking` / `tool_start` / `tool_end` / `token` / `done` / `error` |
| **改动范围** | `apps/api/src/server.ts`（或新路由）、契约包、**`apps/web` 最小流式接入** |

**测试方法（后端 alone）：**

```bash
pnpm run dev:server
curl -N -X POST http://localhost:3000/agent/stream \
  -H 'content-type: application/json' \
  -d '{"input":"请调用 time 工具"}'
```

- 预期：终端逐行收到 SSE 事件，顺序合理，最终以 `done` 结束

**测试方法（必须 — 看效果）：**

```bash
pnpm run dev:server
pnpm run dev:web
# 打开 http://localhost:3001/zh-CN ，发一条会触发工具的消息
```

- 预期：消息区逐字/逐段出现；工具调用中/完成有可见状态（不必做完整调试面板）
- 失败：浏览器 Network 看 event stream；后端日志对照 `taskId`

---

### E.4 新工具 + 安全治理

| | |
|--|--|
| **状态** | 未开始 |
| **目标** | 新增 1 个实用工具（如读文件）；eval 覆盖注入/越权 case |
| **改动范围** | `apps/api/src/tools/`、`PlannerAgent` prompt、eval cases |

**测试方法：**

```bash
pnpm run dev:server
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"<针对新工具的正常请求>"}' | jq .
pnpm run evals:run
```

- 预期：正常请求成功；恶意/越权 case 在 eval 中按设计 fail 或被拦截
- 失败：`task:replay` + 查 `tool_calls.status` / `error_code`

---

### E.5 执行顺序小结

```text
P0  E.1 eval 扩展
P1  E.2 task trace API
P2  E.3 SSE（后端 + 最小前端联调）
P3  E.4 新工具与安全
```

前端 Step 2/4 **不阻塞** E.1–E.2、E.4；**E.3 必须带最小前端**。

---

## F. 全栈路线（备选）

当前**不采用**为默认，仅在前端产品化时再开。

1. Step 2 前端接入 session 列表与历史恢复  
2. Step 4 调试面板补全  
3. Step 5 流式（与【E 节】E.3 合并做）

验收：`docs/web-setup.md` + `pnpm run check:all`

---

## G. 文档索引

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

---

## 后端日常验证命令（速查）

```bash
# 数据库
docker compose -f apps/api/infra/postgres/compose.yaml up -d
pnpm run db:migrate
pnpm run db:check
pnpm run db:inspect

# 服务
pnpm run dev:server          # HTTP API
pnpm run dev                 # CLI 单次 demo（不用于前端联调）

# 回归与排查
pnpm run evals:run
pnpm run task:replay -- <taskId>

# 类型与构建
pnpm run check:all
```
