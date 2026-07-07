# 当前进度与下一步

这是项目的**唯一进度状态源**。做完一项就更新一项，其他文档只保留设计细节，不再各自维护「已完成 / 下一步」。

最后更新：2026-07-07（E.5 学习笔记 + 校验错误 details）

## 30 秒阅读指南

把本文件当成项目「仪表盘」，**不必从头到尾通读**。

**每天开工前（必看）：**

1. 看 **[当前结论](#当前结论先看这里)** —— 今天该做什么、有没有阻塞
2. 看 **[【E 节】后端优先路线](#e-后端优先路线当前采用)** —— 后端学习任务、测试方法、**学习要点与代码阅读路径**
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
| **巩固周每日任务（详细）** | [`docs/consolidation-week.md`](consolidation-week.md) |
| 想搞懂 Agent **完整原理**（推荐主读） | **[`docs/backend-learning/agent-core-flow.md`](backend-learning/agent-core-flow.md)** |
| 想搞懂 `runner.run` / `plan()` 速查 | [`docs/backend-learning/agent-run-chain.md`](backend-learning/agent-run-chain.md) |
| Agent 运行态 / Cursor 式 SSE 计划 | 本文件 [E.3.5](#e35-agent-运行态完整体验cursor-式) |
| API / 表 / 字段怎么命名 | 本文件 [【H 节】命名约定](#h-命名约定) |
| 所有文档分工 | 本文件 [【G 节】文档索引](#g-文档索引) |

**状态怎么读：**

| 状态 | 含义 |
|------|------|
| `已完成` | 验收通过，一般不用再动 |
| `部分完成` | 做了一部分，看表格里还缺哪几行 |
| `进行中` | 已开工、未验收（开工后可手动标上） |
| `未开始` | 还没做 |

**当前开发重点（后端优先）：** 后端 P0–P3（E.1–E.4）已交付；前端 Step 2 已完成；Step 4 工作台内调试面板已完成（独立 `/tasks/[taskId]` 页可选）。

---

## 怎么维护

每完成一个可验收项：

1. 在本文件对应条目把状态改为 `已完成` 或 `进行中`
2. **在【E 节】对应任务下补充或更新「测试方法」「学习要点」「代码怎么读」**（见下方约定）
3. **在改动过的源码里补必要注释**（见下方「代码注释」约定；只注释非显而易见的业务/设计点）
4. **新 API / 表 / 字段命名须符合 [【H 节】命名约定](#h-命名约定)**（避免与业界术语混淆）
5. 若是 Step 级任务，同步改 `docs/fullstack-frontend-plan.md` 里该 Step 的「状态」小节（一行引用即可）
6. 若涉及启动方式或目录变化，同步改 `README.md` 与相关 setup 文档
7. 更新本文件顶部的「最后更新」日期

### 任务完成后的固定交付（【E 节】每项必含）

每做完一项后端（或需要联调的前端）任务，**必须**在【E 节】对应条目写齐以下四块，并在**代码里补注释**（未完成前可只写「测试方法」占位）：

| 块 | 写什么 |
|----|--------|
| **已交付** | 改了哪些文件 / 表 / 接口（ bullet 列表） |
| **测试方法** | 见下方细则 |
| **学习要点** | 本次主要概念、模式、和 Agent 工程的关系（3–5 条，偏「为什么」） |
| **代码怎么读** | 建议阅读顺序（表格：顺序 → 文件 → 看什么）+ 一句心智模型或数据流 |
| **代码注释** | 见下方「代码注释」约定（写在源码里，不重复贴进【E 节】） |

AI / 协作者交付任务时：**聊天里说明 + 源码注释 + 合并前写回本文件【E 节】**，文档与代码一致。

### 代码注释（固定约定）

每做完一项，在**本次改动的文件**里补必要注释，原则：

- **只注释非显而易见的内容**：业务规则、表/字段分工、巧妙判断（如 XOR 校验）、与另一概念的区别（如 `plannerTrace` vs `toolCalls`、vs 分布式 `traceId`）
- **不注释**一眼能看懂的赋值、import、标准 CRUD
- **优先注释**：入口脚本、Agent 核心循环、新表/新 API 字段、契约包 schema、迁移 SQL 文件头

示例位置（E.1/E.2 已示范）：`run-evals.ts` 的 XOR 校验、`planner-agent.ts` 的 `recordStep`、`004_planner_steps.sql` 表头说明。

**Cursor 规则：** `.cursor/rules/code-comments.mdc`（`alwaysApply: true`，每次改代码时 AI 自动遵循）。

**学习路线规则：** `.cursor/rules/backend-first-learning.mdc` —— 前端仅作调试；每次交付须说明后端重点链路。

### 任务完成后的测试方法（固定约定）

每做完一项后端（或需要联调的前端）任务，**必须**在【E 节】写下可复制的验证步骤，至少包含：

- 启动依赖（db / server / web）
- 一条或多条可执行命令（`curl`、`pnpm run …`）
- 预期结果（返回字段、日志、eval 通过率、UI 现象）
- 失败时怎么排查（看哪张表、哪条日志、`task:replay` 用哪个 id）

开发时由 AI/协作者交付任务时一并给出：**测试方法 + 学习要点 + 代码怎么读 + 源码注释**；命名符合【H 节】；合并前进文档写回【E 节】。

状态取值：

| 状态 | 含义 |
|------|------|
| `已完成` | 验收通过，可长期使用 |
| `进行中` | 已开工但未验收 |
| `未开始` | 尚未动手 |
| `部分完成` | 核心能力有，但未达该条目全部验收 |

---

## 当前结论（先看这里）

**路线：** 后端优先学习（见【E 节】与 `.cursor/rules/backend-first-learning.mdc`）。前端工作台仅辅助观察后端；日常用 `curl` + `evals:run` + `task:replay` 验证即可。

**当前开发重点：** **E.5 巩固周** —— 完整每日任务见 [`docs/consolidation-week.md`](consolidation-week.md)。

**前端何时再动：**

| 阶段 | 前端是否要做 |
|------|----------------|
| eval / Planner 决策链 API / 新工具 | 不需要 |
| **SSE 流式（E.3 / E.3.5）** | **已完成** —— RunTimeline + 真 streaming + MD/动画 |
| session 列表 / 完整调试面板 | **Step 2 已完成**；Step 4 工作台内已完成，独立 task 页可选 |

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
| 工具：time / http_fetch / echo / **read_file** | 已完成 | E.4 新增 read_file 沙箱 |
| 工具安全治理 | 已完成 | http_fetch 内网拦截；read_file 路径沙箱/扩展名/大小限制 |
| PostgreSQL 持久化 | 已完成 | sessions / tasks / messages / tool_calls |
| 会话上下文（summary + recent window） | 已完成 | 见 `docs/session-context.md` |
| HTTP API 全套 | 已完成 | 见 `docs/http-api.md` |
| 评测 `pnpm run evals:run` | 已完成 | 见 `docs/evals-and-replay.md` |
| 回放 `pnpm run task:replay` | 已完成 | |
| Planner 决策链 API（`GET /tasks/:taskId` → `plannerTrace[]`） | 已完成 | E.2 |
| SSE `POST /agent/stream` | 已完成 | E.3 通路 + E.3.5 真 streaming / planner_decision |
| Agent 运行态 UI（RunTimeline + MD + 动画） | 已完成 | E.3.5 |

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
| 前端 API client 封装会话/任务接口 | 已完成 |
| 左栏 session 列表 | 已完成 |
| 点击 session 恢复消息时间线 | 已完成 |
| summary preview | 已完成 |
| 归档 session | 已完成 |

**Step 2 总状态：已完成**

**已交付：**

- `apps/web/src/lib/api/api-utils.ts` — 共享 `fetchJson` / `getApiBaseUrl`
- `apps/web/src/lib/api/session-api.ts` — `listSessions` / `getSession` / `getSessionMessages` / `archiveSession` / `getTask`（Zod parse）
- `apps/web/src/features/chat/session-sidebar.tsx` — 左栏列表、新会话、刷新、归档
- `apps/web/src/features/chat/session-history.ts` — 服务端消息 → `ChatItem[]` 还原
- `apps/web/src/features/chat/agent-workbench.tsx` — 挂载拉列表、点击恢复、stream 完成后刷新
- `apps/web/src/locales/sessions/message.ts` — i18n 文案

**测试方法：**

```bash
docker compose -f apps/api/infra/postgres/compose.yaml up -d
pnpm run db:migrate
pnpm run dev:server   # 终端 1
pnpm run dev:web      # 终端 2
pnpm run check:all    # 静态检查
```

浏览器（≥ xl 宽屏，左栏可见）：

1. 打开 `http://localhost:3001/zh-CN`，发 2–3 条不同话题的消息。
2. 左栏应出现 active session 列表，每条有 summary preview（或 id 前缀 fallback）和 `lastTaskAt`。
3. 点「新会话」清空中间对话；再点左栏某条 session，中间应恢复 user/assistant 气泡（历史无 RunTimeline 步骤，仅 answer）。
4. 点归档图标 → 该 session 从左栏消失；`curl` 可确认 status 变为 archived。
5. stream 跑完一条新消息后，左栏列表应自动刷新（summary / 时间更新）。

**学习要点：**

1. **Session 是持久化上下文容器**，Task 是单次 Agent 运行；列表展示 summary，恢复历史要同时拉 `GET /sessions/:id`（含 tasks）和 `messages`。
2. **历史还原 ≠ 实时 SSE 回放**：`sessionMessagesToChatItems` 把落库消息合成简化 `assistant-run`（只有 answer 步骤），RunTimeline 细节需看调试面板或 `GET /tasks/:taskId`。
3. **契约层 Zod parse** 在前端 API client 统一做，字段漂移时 build 期就能发现。
4. **归档是软删除**：列表默认 `status=active`，归档后不再出现在侧栏，数据仍在 DB。

**代码怎么读：**

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `session-api.ts` | 五个 REST 封装 + schema parse |
| 2 | `session-history.ts` | task 排序 → user/assistant 配对 → `ChatItem` |
| 3 | `session-sidebar.tsx` | 列表 UI、选中态、归档/刷新按钮 |
| 4 | `agent-workbench.tsx` | `loadSession` / `refreshSessions` / `handleArchiveSession` 与 stream 联动 |

心智模型：**挂载 list → 点击 loadSession（messages+tasks→chat）→ 新消息 stream → done 后 refreshSessions + reloadSessionDebug**。

| 验收项 | 状态 |
|--------|------|
| `packages/api-contract` | 已完成 |
| 后端 request 校验 | 已完成 |
| 前端复用类型 + Zod parse | 已完成 | session/task API 已接入 contract |

**Step 3 总状态：已完成**（前端扩大使用范围属于 Step 2 一并做）

### Step 4：Agent 调试面板

| 验收项 | 状态 |
|--------|------|
| 展示 sessionId / taskId | 已完成 |
| 展示工具调用 | 已完成 |
| 展示 message timeline（服务端历史） | 已完成 |
| 展示 session summary | 已完成 |
| 展示 task status / error | 已完成 |
| 任务详情页 `/tasks/[taskId]` | 未开始 | 调试面板内嵌 task/plannerTrace，无独立路由 |

**Step 4 总状态：部分完成**（工作台内调试面板已覆盖 timeline/summary/task；独立 task 页待做）

**已交付（工作台内）：**

- `apps/web/src/features/chat/debug-panel.tsx` — session summary、服务端 message timeline、task status/error、plannerTrace、工具调用
- `agent-workbench.tsx` — `reloadSessionDebug` + `taskId` 变化时 `getTask` 填充右栏

**测试方法：**

同 Step 2 启动方式。选中某 session 或跑完一条 stream 后：

1. 右栏「Session summary」应显示后端 rolling summary（无则为占位）。
2. 「Message timeline」列出 `GET .../messages` 的 role/content/taskId（按时间）。
3. 最新 task 的 status、errorMessage 可见；有 planner 步骤时展示 `plannerTrace` JSON 树。
4. 实时 stream 过程中，工具调用仍来自当前 RunTimeline；stream 结束后 task 详情与 timeline 对齐。

**学习要点：**

1. **调试面板读的是服务端真相**：summary / messages / plannerTrace 来自 REST；中间对话区的 RunTimeline 是 live SSE 态。
2. **`plannerTrace` 只在 task 详情里**，不在 session messages 里 —— 选中 session 后需 `getTask(lastTaskId)` 才能看决策链。
3. **task status/error 帮助排查失败 run**，与聊天气泡里的 failed 状态对应同一 `taskId`。

**代码怎么读：**

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `debug-panel.tsx` | 各区块 props 与渲染 |
| 2 | `agent-workbench.tsx` | `reloadSessionDebug`、`useEffect` 拉 `getTask` |
| 3 | `session-api.ts` | `getTask` 返回 `plannerTrace` |

### Step 5：流式响应（E.3 + E.3.5）

| 验收项 | 状态 |
|--------|------|
| 后端 SSE `POST /agent/stream`（通路） | 已完成 |
| 前端接 SSE（最小单气泡） | 已完成 |
| 真 LLM `stream: true` → 实时 `token` | 已完成 | E.3.5-a |
| SSE 事件 `planner_decision`（调什么工具） | 已完成 | E.3.5-b |
| 对话内 **RunTimeline**（规划 / 工具 / 回答分步） | 已完成 | E.3.5-c |
| 工具卡片：running → output / error 可展开 | 已完成 | E.3.5-c |
| 回答 **Markdown 渲染**（`react-markdown` + GFM） | 已完成 | E.3.5-d |
| 步骤/状态 **动画**（入场、running、完成） | 已完成 | E.3.5-e |
| 代码块高亮 / 复制（可选增强） | 未开始 | E.3.5-f P1 |

**Step 5 总状态：已完成**（E.3 通路 + E.3.5 Cursor 式体验）

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
| **状态** | 已完成 |
| **目标** | 多补 eval case，覆盖会话记忆、工具命中、失败任务、工具预算 |
| **改动范围** | `apps/api/evals/cases/`、`apps/api/src/scripts/run-evals.ts` |

**已交付：**

- 用例 4 → **8 条**（`basic-agent-cases.json`）
- 新增：`echo-tool-smoke`、`greet-no-tools`、`blocked-localhost`、`session-memory-city`（`steps[]` 多轮同 session）
- `run-evals.ts`：支持 `steps[]` 多轮评测、`expectedErrorCode` / `expectedTaskStatus`、启动前 DB 预检、失败时 `exitCode=1`

**测试方法：**

```bash
docker compose -f apps/api/infra/postgres/compose.yaml up -d
pnpm run db:migrate
pnpm run db:check
pnpm run evals:run
```

- 预期：终端输出 `passed: 8`、`failed: 0`；报告写入 `apps/api/evals/reports/eval-run-*.json`
- 若**全部失败**且 `errorCode: INTERNAL_ERROR`、单条 `durationMs` < 10 → PostgreSQL 未启动，先执行上面 `docker compose` + `db:migrate`
- 改 `PlannerAgent` / 工具后重跑，确认回归能抓住行为变化
- 某条失败：用报告里的 `taskId` 执行 `pnpm run task:replay -- <taskId>`

**学习要点：**

1. **Agent 回归测的是端到端行为**，不是单个函数：工具选择、关键词、失败码都要在真实 LLM + DB 链路里验证。
2. **eval 用例 = 预设任务 + 断言**：JSON 描述输入与期望；报告是跑完后的 pass/fail 快照。
3. **`steps[]` 测多轮 session**：同一 `sessionId` 顺序跑多轮，只在最后一轮断言——用来验证会话记忆是否生效。
4. **eval 脚本要 CI 友好**：启动前 DB 预检；有失败则 `exitCode = 1`，方便以后挂流水线。

**代码怎么读：**

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `apps/api/evals/cases/basic-agent-cases.json` | 8 条用例各自测什么；`input` vs `steps` |
| 2 | `apps/api/src/scripts/run-evals.ts` | 主流程：`loadCases` → `runEvalCase` → `evaluateCase` → 写报告 |
| 3 | 同上 `runEvalCase` | 多轮：`createSession` + 循环 `runner.run` |
| 4 | 同上 `evaluateCase` | 断言：工具名、关键词、错误码、工具次数 |
| 5 | `apps/api/src/runtime/task-runner.ts` | eval 实际调用的「一次任务生命周期」 |

心智模型：`eval case JSON` → `run-evals.ts`（编排 + 断言）→ `TaskRunner.run` → `PlannerAgent` + tools → `eval-run-*.json` 报告。

---

### E.2 Planner 决策链 API（`plannerTrace`）

| | |
|--|--|
| **状态** | 已完成 |
| **目标** | `GET /tasks/:taskId` 能还原每一步：step、needsTool、toolName、耗时、错误 |
| **改动范围** | `planner_steps` 表、`PlannerAgent` 落库、`GET /tasks/:taskId` 返回 `plannerTrace`、`packages/api-contract` |

**命名说明：** 响应用 `plannerTrace`（Planner 决策链），**刻意不用 `trace`**，避免与 OpenTelemetry / 分布式 `traceId` 混淆。完整规则见本文件 [【H 节】命名约定](#h-命名约定)。

**已交付：**

- 新表 `planner_steps`（迁移 `004_planner_steps.sql`）
- `PlannerAgent` 每轮规划循环写入一步：`needsTool`、`toolName`、`durationMs`、`outcome`、`errorCode`
- `GET /tasks/:taskId` 响应字段 `plannerTrace[]`；`task:replay` 同步输出 `plannerTrace`

**测试方法：**

```bash
docker compose -f apps/api/infra/postgres/compose.yaml up -d
pnpm run db:migrate
pnpm run dev:server

# 触发带工具的任务，记下 taskId
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请调用 time 工具告诉我当前时间，一句话回答。"}' | jq -r '.taskId'

# 替换 <taskId>
curl -s http://localhost:3000/tasks/<taskId> | jq '.plannerTrace'
pnpm run task:replay -- <taskId>
```

- 预期：`plannerTrace` 至少 1 步；调用了 `time` 时可见 `needsTool: true`、`toolName: "time"`、`outcome: "tool_executed"`；随后通常还有一步 `outcome: "direct_answer"`
- `outcome` 枚举：`direct_answer` | `tool_executed` | `tool_failed` | `budget_exceeded` | `duplicate_skipped` | `fallback_answer`
- 失败：查 `planner_steps` 表（`pnpm run db:inspect`），或对比 `tool_calls` 与 `plannerTrace` 的 `step` 是否对齐

**学习要点：**

1. **「任务结果」和「决策过程」是两回事**：`tool_calls` 记录工具执行；`plannerTrace`（`planner_steps`）记录模型**每一步**要不要工具、选哪个、耗时、结果类型。
2. **`plannerTrace` ≠ 分布式 trace**：后者是 `traceId` + span 树；这里是 Agent 规划循环的决策链。
3. **Agent 是多步规划，不是一次 LLM 调用**：典型路径 `plan` → 执行工具 → 再 `plan` → 直接回答；`plannerTrace` 常有 2 步（如 `tool_executed` + `direct_answer`）。
4. **观测与业务分离**：在 `PlannerAgent` 循环里落库决策；HTTP 只读聚合返回 `plannerTrace[]`，不改 Agent 核心逻辑。

**代码怎么读：**

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `apps/api/infra/postgres/init/004_planner_steps.sql` | 表字段：`step`、`needs_tool`、`outcome`、`duration_ms` |
| 2 | `apps/api/src/agents/planner-agent.ts` | 主循环；搜 `recordStep` / `recordPlannerStep` 与各 `outcome` 分支 |
| 3 | `apps/api/src/memory/postgres-memory-store.ts` | `recordPlannerStep` / `listTaskPlannerSteps` |
| 4 | `apps/api/src/server.ts` | `GET /tasks/:taskId` 并行返回 `plannerTrace` |
| 5 | `packages/api-contract/src/schemas.ts` | `PlannerStepRecordSchema`、`GetTaskResponseSchema.plannerTrace` |
| 6 | `apps/api/src/scripts/replay-task.ts` | CLI 回放是否也带 `plannerTrace` |

心智模型：`llm.plan()` → 分支（direct / tool / budget / duplicate / fail）→ `recordPlannerStep` → `GET /tasks` 读 `plannerTrace`；对照 `plannerTrace[].step` ↔ `tool_calls.step`，`direct_answer` 通常无对应 tool_call。

---

### E.3 Streaming endpoint（SSE）— 通路（最小）

| | |
|--|--|
| **状态** | 部分完成 |
| **目标** | 打通 `POST /agent/stream` + 最小前端联调 |
| **说明** | **Cursor 式完整体验见 [E.3.5](#e35-agent-运行态完整体验cursor-式)**；本节仅记录 E.3 已交付的通路 |

**已交付：**

- `POST /agent/stream`：SSE（`text/event-stream`），事件名 = JSON `type` 字段
- 契约：`AgentStreamEventSchema`（6 种事件）
- `PlannerAgent` 在规划/工具/最终回答处 `emitStream`；`token` 为完整回答切片模拟（LLM 尚未真流式）
- 前端：`streamAgent` + workbench 逐段展示 + debug 面板工具态

**命名说明：** SSE 事件用 `AgentStreamEvent.type`（如 `thinking`），**不是** OpenTelemetry `traceId`；持久化决策链仍看 `plannerTrace`（【H 节】）。

**测试方法（后端 alone）：**

```bash
pnpm run dev:server
curl -N -X POST http://localhost:3000/agent/stream \
  -H 'content-type: application/json' \
  -d '{"input":"请调用 time 工具，用一句话告诉我当前时间"}'
```

- 预期：依次收到 `thinking` → `tool_start` → `tool_end` → `thinking` → 多个 `token` → `done`；最终以 `event: done` 结束

**测试方法（必须 — 看效果）：**

```bash
pnpm run dev:server
pnpm run dev:web
# 打开 http://localhost:3001/zh-CN ，发一条会触发工具的消息
```

- 预期：助手消息先显示「思考/工具执行中」，再逐段出现回答；右侧 debug 可见工具 running/succeeded
- 失败：浏览器 Network → `agent/stream` 看 event stream；后端日志对照 `taskId`

**学习要点：**

1. **SSE = 单向推送**：服务端 `event:` + `data:` 帧；适合 Agent 长任务进度，与 WebSocket 全双工不同。
2. **流式分两层**：**过程事件**（thinking / tool_*）实时推；**token** 当前为回答切片模拟，真 LLM streaming 以后可替换 `emitTokenStream`。
3. **`emitStream` 注入 AgentContext**：/`agent/run` 不传；`/agent/stream` 由 `TaskRunner` 传入，Planner 无 HTTP 耦合。
4. **done 携带完整 result**：与 `/agent/run` 同结构，前端可在流结束后对齐 `sessionId` / `toolCalls`。

**代码怎么读：**

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `packages/api-contract/src/stream-events.ts` | 6 种 SSE 事件 schema |
| 2 | `apps/api/src/http/sse-response.ts` | `initSseResponse` / `writeSseEvent` |
| 3 | `apps/api/src/server.ts` | `POST /agent/stream` 路由 |
| 4 | `apps/api/src/runtime/agent-stream.ts` | `emitTokenStream` 切片逻辑 |
| 5 | `apps/api/src/agents/planner-agent.ts` | 搜 `emitStream` / `emitThinking` |
| 6 | `apps/web/src/lib/api/agent-api.ts` | `streamAgent` |
| 7 | `apps/web/src/lib/api/sse-client.ts` | 浏览器侧 SSE 解析 |
| 8 | `apps/web/src/features/chat/agent-workbench.tsx` | `switch (event.type)` UI |

心智模型：`/agent/stream` → SSE 写头 → `TaskRunner.run({ emitStream })` → Planner 推事件 → `done` 收尾；持久化仍走 DB，SSE 只负责「进行中」展示。

**已知局限（E.3.5-f 可选）：** 代码块无语法高亮/复制按钮；超长 tool output 仅折叠展开，无分页。

---

### E.3.5 Agent 运行态完整体验（Cursor 式）

| | |
|--|--|
| **状态** | 已完成（a–e）；**E.3.5-f** 代码高亮/复制仍为 P1 |
| **目标** | 用户能**实时**看到：正在规划什么 → 正在调哪个工具（入参）→ 工具结果/错误 → 回答逐字/逐段出现（MD 渲染 + 动画） |
| **定位** | Agent **核心交互面**；E.3 为通路 MVP，本节为产品级验收 |
| **改动范围** | 后端 + `packages/api-contract` + `apps/web` |

#### 已交付

| 阶段 | 内容 | 主要文件 |
|------|------|----------|
| **E.3.5-a** | 混元 `stream: true`；边收边推 `token`；SSE `flush()` + `x-accel-buffering: no` | `hunyuan-llm-client.ts`、`llm-client.ts`、`planner-agent.ts`、`sse-response.ts`、`agent-stream.ts` |
| **E.3.5-b** | SSE 事件 **`planner_decision`**：`step`、`needsTool`、`toolName`、`toolInput` | `stream-events.ts`、`planner-agent.ts` |
| **E.3.5-c** | **RunTimeline**：规划 / 决策 / 工具 / 回答分步；工具卡片 inline 可展开 | `run-types.ts`、`apply-stream-event.ts`、`run-timeline.tsx`、`tool-step-card.tsx`、`agent-workbench.tsx` |
| **E.3.5-d** | 流式正文 **Markdown**（GFM 列表/链接/代码块） | `markdown-message.tsx`（`react-markdown` + `remark-gfm`）、`globals.css` `.prose-agent` |
| **E.3.5-e** | 步骤入场动画（`framer-motion`）、running spinner、streaming 光标 | `run-timeline.tsx`、`markdown-message.tsx` |

#### 测试方法

```bash
pnpm run check:all

pnpm run dev:server
pnpm run dev:web
# http://localhost:3001/zh-CN
# 1) 「请调用 time 工具，用一句话告诉我当前时间」
#    预期：RunTimeline 依次出现 planner_decision → tool 卡片 running → output → MD 流式回答
# 2) 「用 markdown 列表总结三个优点」
#    预期：回答区渲染列表，非裸 # / -

curl -N -X POST http://localhost:3000/agent/stream \
  -H 'content-type: application/json' \
  -d '{"input":"请调用 time 工具，用一句话告诉我当前时间"}'
# 预期：含 event: planner_decision；token 在生成过程中分散到达（非同一毫秒连发）
```

- 失败：浏览器 Network → `agent/stream` 看 event 顺序；`pnpm run task:replay -- <taskId>` 对照 `plannerTrace`

#### 学习要点

1. **SSE 事件 = live UX；plannerTrace = 落库审计** —— `planner_decision` 只在流里推，结束后用 `GET /tasks/:taskId` 回放决策链。
2. **真 streaming vs fallback 切片**：`answerWithTool(..., { onToken })` 走混元 `stream: true`；仅未 stream 时对 `draftAnswer` 用 `emitTokenStream` 兜底。
3. **`applyStreamEvent` 纯函数归约**：SSE 事件 → `RunStep[]`，便于单测与 UI 解耦；`done` 时用 `finalizeAnswerStep` 对齐最终 summary。
4. **RunTimeline 是 Agent 产品核心**，右侧 debug 面板只作 session/task/工具摘要补充。

#### 代码怎么读

| 顺序 | 区域 | 文件 |
|------|------|------|
| 1 | 契约 | `packages/api-contract/src/stream-events.ts` |
| 2 | LLM 流 | `apps/api/src/llm/hunyuan-llm-client.ts` → `answerWithTool` streaming 分支 |
| 3 | 推事件 | `apps/api/src/agents/planner-agent.ts`（搜 `emitPlannerDecision`、`createTokenHandler`） |
| 4 | SSE 写帧 | `apps/api/src/http/sse-response.ts`、`apps/api/src/runtime/agent-stream.ts` |
| 5 | 事件归约 | `apps/web/src/features/chat/apply-stream-event.ts` |
| 6 | 时间线 UI | `run-timeline.tsx`、`tool-step-card.tsx` |
| 7 | MD | `markdown-message.tsx` |
| 8 | 编排 | `agent-workbench.tsx`（`streamAgent` → `patchAssistantRun`） |

#### 与 E.4 关系

- **E.3.5 优先于 E.4**：先把「跑 Agent」的体验做完整，再加新工具  
- E.4 新增工具必须复用同一套 SSE 事件 + RunTimeline 卡片，避免第二套 UI  

---

### E.4 新工具 + 安全治理

| | |
|--|--|
| **状态** | 已完成 |
| **目标** | 新增实用 `read_file` 工具；eval 覆盖正常读取与越权/路径穿越拦截 |
| **改动范围** | `read-file-tool.ts`、`env.ts`、`create-agent-runtime.ts`、Planner prompt、eval cases + fixture |

#### 已交付

| 项 | 说明 |
|----|------|
| **`read_file` 工具** | 仅读沙箱目录内文本文件（默认 `apps/api/evals/fixtures`） |
| **安全治理** | 禁止 `..`/绝对路径；隐藏文件与 `.env` 等 denylist；扩展名白名单；最大字节数 |
| **Planner prompt** | 本地文件读取场景引导调用 `read_file` |
| **eval 用例 +3** | `read-file-fixture` / `blocked-read-env-traversal` / `blocked-read-absolute-path` |
| **RunTimeline** | 无需改 UI，复用现有 `tool_start` / `tool_end` 卡片 |

#### 测试方法

```bash
pnpm run check:all

pnpm run dev:server
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 read_file 读取 sample-notes.txt，告诉我提到的城市"}' | jq .

curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 read_file 读取 ../../../.env"}' | jq .
# 预期：task failed，error.code = BAD_REQUEST

pnpm run evals:run
# 预期：11 条用例全过（含 3 条 read_file 相关）
```

- 失败：`pnpm run task:replay -- <taskId>`，查 `tool_calls.status` / `error_code`

#### 学习要点

1. **工具安全在 Tool 层 enforce**，不依赖 LLM「自觉」——越权路径在 `execute()` 内直接 `BAD_REQUEST`。
2. **`path.resolve` + 前缀校验** 是沙箱读文件的常见模式；还要防隐藏文件与扩展名绕过。
3. **eval 分两类**：正常能力（`expectedTools` + `expectedKeywords`）与安全（`expectedErrorCode` + `expectedTaskStatus: failed`）。
4. 新工具**不用新 SSE 事件**——RunTimeline 工具卡片自动复用。

#### 代码怎么读

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `apps/api/src/tools/read-file-tool.ts` | `resolveSafePath`、扩展名/大小/denylist |
| 2 | `apps/api/src/config/env.ts` | `READ_FILE_*` 配置项 |
| 3 | `apps/api/src/app/create-agent-runtime.ts` | 工具注册 |
| 4 | `apps/api/src/llm/hunyuan-llm-client.ts` | Planner system prompt |
| 5 | `apps/api/evals/cases/basic-agent-cases.json` | 3 条新 case |
| 6 | `apps/api/evals/fixtures/sample-notes.txt` | eval 夹具 |

---

### E.5 巩固周（当前进行）

| | |
|--|--|
| **状态** | 进行中 |
| **目标** | 读通 E.1–E.4 已交付后端；`curl` + eval + replay 建立肌肉记忆 |
| **详细手册** | **[`docs/consolidation-week.md`](consolidation-week.md)**（Day 1–5 读码、手测、自检、调试说明） |
| **概念笔记** | **[`docs/backend-learning/`](backend-learning/README.md)**（body、Debug、`runner.run`→`plan()`、400 `details`） |

**Day 概要：**

| 天 | 主题 |
|----|------|
| Day 1 | HTTP 入口 + Task 生命周期 |
| Day 2 | Planner 循环 + SSE + plannerTrace |
| Day 3 | Session 上下文 summary + window |
| Day 4 | Eval 回归 + 故意改坏 |
| Day 5 | Memory 五表 + 工具安全 + 总自检 |

巩固周结束后选 E.6：扩 eval / 新工具 / 轻量 RAG。

---

### E.5 执行顺序小结（历史 P0–P3）

```text
P0  E.1 eval 扩展                         ← 已完成
P1  E.2 Planner 决策链 API（plannerTrace） ← 已完成
P2  E.3 SSE 通路                          ← 已完成
P2.5 E.3.5 Agent 运行态完整体验           ← 已完成
P3   E.4 新工具 + 安全治理                ← 已完成
P4   E.5 巩固周（读通 + eval 手练）       ← 当前
```

前端 Step 2/4 **不阻塞** E.1–E.2、E.4；**E.3 / E.3.5 必须带前端**（E.3.5 为 Step 5 主验收）。

---

## F. 全栈路线（备选）

当前**不采用**为默认，仅在前端产品化时再开。

1. ~~Step 2 前端接入 session 列表与历史恢复~~ **已完成**
2. Step 4 调试面板 — 工作台内已完成；可选：独立 `/tasks/[taskId]` 页
3. ~~Step 5 流式（E.3 + E.3.5）~~ **已完成**；可选：E.3.5-f 代码块高亮

验收：`docs/web-setup.md` + `pnpm run check:all`

---

## H. 命名约定

新增 API 字段、数据库表、契约 schema、文档术语时**必须**遵守本节。AI / 协作者交付前自检；合并前写进契约与 `docs/http-api.md`。

### 总则

| 层 | 风格 | 示例 |
|----|------|------|
| HTTP JSON / 契约 / TS 类型 | camelCase | `plannerTrace`、`toolCalls`、`sessionId` |
| PostgreSQL 表与列 | snake_case | `planner_steps`、`needs_tool`、`task_id` |
| 脚本 / CLI 输出字段 | 与 HTTP 一致 | `task:replay` 的 `plannerTrace` 对齐 `GET /tasks` |

**禁止**用含义过宽、且与业界惯例冲突的单词单独作字段名（尤其 `trace`），除非上下文明确指分布式链路追踪。

### Agent 任务观测：三个概念分开命名

同一任务下有三类数据，**不可混叫「trace」**：

| 概念 | 是什么 | 正确命名（API） | 正确命名（DB） | 回答的问题 |
|------|--------|-----------------|----------------|------------|
| **Planner 决策链** | 每轮 `llm.plan` 要不要工具、选哪个、outcome | **`plannerTrace`** | `planner_steps` | 为什么调了 time？走了几步 plan？ |
| **工具执行** | 工具实际 input/output、成功失败 | **`toolCalls`** | `tool_calls` | 工具跑没跑、结果是什么？ |
| **对话时间线** | user / assistant / tool 消息 | **`messages`** | `messages` | 对话里留下了什么？ |
| **SSE 过程事件** | 进行中 thinking / tool / token | **`AgentStreamEvent.type`** | （不落库，仅 SSE） | 现在进行到哪一步？ |

```text
❌ 错误：GET /tasks 返回 trace: []     → 易与 OpenTelemetry traceId 混淆
✅ 正确：GET /tasks 返回 plannerTrace: []
```

### 分布式链路追踪（未来预留）

若以后接入 OpenTelemetry / Jaeger / 结构化请求日志，使用 **`traceId`**、**`spanId`** 等业界通用名，**不要**占用 `plannerTrace` 或单独叫 `trace` 指 Agent 决策。

| 场景 | 用什么 | 不要用什么 |
|------|--------|------------|
| Agent Planner 每步决策 | `plannerTrace` / `planner_steps` | `trace`、`decisionTrace`（未统一前勿新增同义名） |
| SSE 进行中事件 | `AgentStreamEvent.type`（`thinking`、`tool_start`…） | `trace`、与 `plannerTrace` 混用 |
| HTTP/RPC 全链路 | `traceId`、`spanId`（未来） | 复用 `plannerTrace` |
| 一次 Agent 任务主键 | `taskId`（已有） | 与 `traceId` 混为一谈 |

### 新增字段自检（合并前过一遍）

1. 会不会和后端同学直觉里的 **traceId / APM trace** 混淆？
2. 会不会和已有的 `toolCalls` / `plannerTrace` / `messages` 语义重叠？
3. 契约（`packages/api-contract`）、`server.ts`、`replay-task.ts`、注释、文档是否**同名同步**？
4. 若引入新表，API 字段是否与表名有清晰映射（如 `planner_steps` → `plannerTrace`）？

### 已落地示例（E.2）

- 表：`planner_steps`（决策快照）
- 方法：`recordPlannerStep` / `listTaskPlannerSteps`
- API / replay / 契约：**`plannerTrace`**（不用 `trace`）

细节见 `docs/http-api.md` Get Task Detail 与【E 节】E.2。

---

## G. 文档索引

| 文档 | 用途 |
|------|------|
| **本文件** | 进度与下一步（状态源）；【E 节】交付约定；【H 节】命名约定 |
| **`docs/backend-learning/agent-core-flow.md`** | **Agent 完整原理手册（HTTP→落库→Session→Eval→安全）** |
| **`docs/backend-learning/`** | HTTP body / Agent 全链路 / Debug / 400 details 概念笔记 |
| **`docs/consolidation-week.md`** | **E.5 巩固周完整手册**（Day 1–5 详细任务） |
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
