# E.5 巩固周：后端链路手练计划

> **进度状态**见 `docs/current-status.md` §E.5。本文是巩固周的**完整学习手册**（每日任务、命令、读码顺序、自检清单）。
>
> **路线：** 后端优先。前端工作台仅辅助观察；日常验证以 `curl` + `evals:run` + `task:replay` 为主。

---

## 目标与边界

| 项 | 说明 |
|----|------|
| **目标** | 读通 E.1–E.4 已交付后端，**不新增功能**；建立 Agent 请求全链路肌肉记忆 |
| **周期** | 建议 5 天 × 1–2h（可压缩为 2–3 天） |
| **前置** | E.1–E.4、Step 2/5 已完成；TokenHub Key 已配置（见 `apps/api/.env.example`） |
| **验收** | 文末「巩固周总自检」全部打勾 |

**今天不要做的事：**

- 不引入新工具、不改架构
- 不必深入 React/Next.js（UI 只作对照）
- 巩固周内不必做独立 `/tasks/[taskId]` 页、shadcn 等前端增强

---

## 环境速查（每天开工前）

```bash
# 1. 数据库
docker compose -f apps/api/infra/postgres/compose.yaml up -d
pnpm run db:migrate
pnpm run db:check

# 2. 后端（二选一，不要同时占用 3000）
pnpm run dev:server                              # 热更新，日常联调
# 或 Cursor：运行和调试 → API: Debug HTTP Server  # 断点调试，见下文

# 3. 确认 API 已监听（必须看到 JSON，否则前端会 Failed to fetch）
curl -s http://127.0.0.1:3000/health | jq .

# 4. 前端（可选，仅对照 API 现象）
pnpm run dev:web   # http://localhost:3001/zh-CN
```

### 调试后端（`.vscode/launch.json`）

| 配置 | 用途 |
|------|------|
| **API: Debug HTTP Server** | 断点跟 `server.ts` → `task-runner`（巩固周主用） |
| **API: Debug Evals** | 断点跟 `run-evals.ts`（Day 4） |
| **API: Debug Task Replay** | 输入 taskId 回放（Day 2/4 排查） |

**调试注意：**

1. F5 后在 **调试控制台**（不是 curl 终端）必须出现 `"message": "HTTP server started"`，再 curl / 开前端
2. 若工具栏处于**暂停**，按 Continue（F5）直到 server listen
3. **不要**同时跑 `dev:server` 与 Debug HTTP Server（抢 3000 端口）
4. 断点建议打在 `prepare-agent-run.ts` / `task-runner.ts`；`console.log(req)` 看不到 `input`，见 [`backend-learning/http-request-body.md`](backend-learning/http-request-body.md)
5. 启动失败、Connection refused：见 [`backend-learning/debug-http-server.md`](backend-learning/debug-http-server.md)

### 概念对照（全周通用）

| 前端调试台 / API 字段 | 后端真相 |
|----------------------|----------|
| 左栏 session 列表 | `GET /sessions` → `sessions` 表 |
| summary preview | `sessions.summary`（`summarizeSession` 写入） |
| message timeline | `GET .../messages` → `messages` 表 |
| task status / error | `GET /tasks/:id` → `tasks` 表 |
| plannerTrace | `planner_steps` 表（≠ OpenTelemetry `traceId`） |
| RunTimeline 工具卡 | live SSE `tool_*` + 落库 `tool_calls` |

---

## 全链路总图（背下来）

> **完整原理（推荐主读）：** **[`docs/backend-learning/agent-core-flow.md`](backend-learning/agent-core-flow.md)**  
> 含：依赖注入、Session 上下文、五张表、工具安全、SSE、Eval/Replay、失败路径、巩固周总自检。  
> 下文为**背诵用缩略图**；细节以完整手册为准。

### 核心思想（先记这三句）

1. **HTTP 只负责进门和出门** — 读 body、校验、分配 id、调 `runner.run`、写响应；不碰 LLM。
2. **TaskRunner 是任务状态机外壳** — 管 `tasks` 从 running → succeeded/failed；不管「要不要工具」。
3. **PlannerAgent 是 Agent 大脑** — 循环里问 LLM → 可选 Tool → 再组织人话；落库 `planner_steps` + `tool_calls`。

```text
runner.run = DB 生命周期 | agent.plan = Agent 循环 | llm.plan = 要不要工具
```

### 四层分工

| 层 | 文件 | 只管 | 不管 |
|----|------|------|------|
| HTTP | `server.ts` | 路由、契约、id、响应 | LLM、工具 |
| 任务外壳 | `task-runner.ts` | tasks/messages 状态机 | 工具选择 |
| Agent 大脑 | `planner-agent.ts` | plan 循环、工具、落库 | HTTP、混元 API |
| LLM 适配 | `hunyuan-llm-client.ts` | prompt、function calling | 落库、工具安全 |

---

### 展开总图（缩略 — 细节见 agent-core-flow.md）

```text
curl → server(readJsonBody→Zod→prepareAgentRun→runner.run)
  → TaskRunner(①createTask ②updateSession ③append user ④plan ⑤succeeded/⑥failed)
  → Planner(0 buildSessionContext → A–J 循环 → J append assistant)
  → LLM(summarizeSession? / plan / answerWithTool)
  → DB(sessions|tasks|messages|planner_steps|tool_calls)
  → GET /tasks/:id 观测
```

**本文档未展开、但在完整手册有专章：**

| 主题 | 手册章节 |
|------|----------|
| `create-agent-runtime` 依赖注入 | §启动与依赖注入 |
| `buildSessionContext` / summary | §Session 上下文 |
| 五张表 + MemoryStore | §Memory 五张表 |
| http_fetch / read_file 安全 | §工具层与安全治理 |
| SSE 事件表 | §SSE 流式 |
| eval / replay | §Eval 与 Task Replay |
| 400 details / 契约 | §HTTP 层 + §契约层 |
| 失败路径 | §失败路径全景 |

### LLM 调用次数（速记）

| 场景 | 调用 | 次数 |
|------|------|------|
| 简单问答 | 仅 `plan` | **1** |
| 要工具 | `plan` + `answerWithTool` | **2** |
| 长会话需摘要 | + `summarizeSession` | **+1** |

### 三张表别混

| 调试面板 | DB | 记什么 |
|----------|-----|--------|
| plannerTrace | planner_steps | **决策**（outcome） |
| toolCalls | tool_calls | **执行** |
| messages | messages | **对话文本** |

`/agent/run` 与 `/agent/stream`：**落库相同**；stream 多 `emitStream` 实时展示。


---

## Day 1：HTTP 入口与 Task 生命周期

**时间：** 1.5–2h  
**边界：** 只读到 `agent.plan()` 当黑盒，不深入 Planner 内部（Day 2 再拆）。

### 总链路

```text
POST /agent/run
  → server.ts (L48–54)
  → prepareAgentRun
  → TaskRunner.run()
       → createTask / append(user) / plan() / updateTask
  → 返回 { sessionId, taskId, result }
```

### 读代码（40 分钟）

| 顺序 | 文件 | 看哪 | 要搞懂什么 |
|------|------|------|------------|
| ① | `apps/api/src/server.ts` | 文件头 L1–11 | 四类路由；编排链 |
| ② | `server.ts` | L27–29 `main()` | `createAgentRuntime` 注入 runner/memory |
| ③ | `server.ts` | L48–54 `/agent/run` | 读 body → 校验 → prepare → run → JSON |
| ④ | `apps/api/src/http/prepare-agent-run.ts` | 全文 | sessionId 分配；何时 createSession |
| ⑤ | `apps/api/src/runtime/task-runner.ts` | L25–91 `run()` | try 写库 + plan；catch → failed |
| ⑥ | `server.ts` | L158–173 `GET /tasks/:id` | 观测接口四块数据 |

可选 5 分钟：`apps/api/src/app/create-agent-runtime.ts` — 依赖如何组装。

### 手测 A：最小请求（20 分钟）

```bash
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"用一句话介绍你自己"}' \
  | tee /tmp/day1-run.json | jq .

export SESSION_ID=$(jq -r .sessionId /tmp/day1-run.json)
export TASK_ID=$(jq -r .taskId /tmp/day1-run.json)

curl -s http://localhost:3000/tasks/$TASK_ID | jq '{
  taskStatus: .task.status,
  messageRoles: [.messages[].role],
  toolCallCount: (.toolCalls | length),
  plannerStepCount: (.plannerTrace | length)
}'
```

**期望：** `taskStatus: succeeded`；`messageRoles` 含 `user`、`assistant`；`toolCallCount: 0`。

对照终端日志顺序：`Task started` → `Planner step decided` → `Task finished`。

### 手测 C：故意传错 body（校验错误工程化，10 分钟）

理解 `readJsonBody` + Zod 契约；错误响应应带 `error.details` 字段级说明。

```bash
# 错字段名
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input1":"test"}' | jq .

# 类型错误（input 应是 string）
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":111}' | jq .
```

**期望：** `error.code` 为 `BAD_REQUEST`；`error.details` 数组指明是缺 `input`、未知 key `input1`，或 `expected string, received number`。

阅读：[`docs/backend-learning/request-validation-errors.md`](backend-learning/request-validation-errors.md)、[`http-request-body.md`](backend-learning/http-request-body.md)。

### 手测 B：同 session 第二次 run（15 分钟）

```bash
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d "{\"input\":\"刚才我问了什么？\",\"sessionId\":\"$SESSION_ID\"}" \
  | jq '{sessionId, taskId}'

curl -s http://localhost:3000/sessions/$SESSION_ID | jq '.tasks | length'
# 期望：2（一个 session，两个 task）
```

### 手测 C：失败路径（15 分钟）

```bash
# 400：校验失败，未进 TaskRunner
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":""}' | jq .

# 404：task 不存在
curl -s http://localhost:3000/tasks/00000000-0000-0000-0000-000000000000 | jq .
```

### Day 1 自检

- [ ] 能说出 `/agent/run` 五步：读 body → 校验 → prepare → run → 写 JSON
- [ ] 能解释 `sessionId`（长期容器）vs `taskId`（单次 run）
- [ ] 知道 `TaskRunner` 在 `plan()` 前后各写哪些表
- [ ] 会用 `GET /tasks/:id` 看 status 和 messages
- [ ] 区分 400（校验）与 404（not found）在哪一层抛出

### Day 1 学习要点

HTTP 层只做路由与校验；**Task 状态机**在 TaskRunner；Agent 智能在 `plan()` 里（明天读）。

---

## Day 2：Planner 循环与三次 LLM 调用

**时间：** 1.5–2h  
**目标：** 搞清 `plan` 循环、SSE 事件顺序、`plannerTrace` vs `toolCalls`。  
**概念笔记：** [`docs/backend-learning/agent-core-flow.md`](backend-learning/agent-core-flow.md)（完整手册）；[`§常见追问`](backend-learning/agent-core-flow.md#常见追问学习笔记)（记忆 / 工具决策 FAQ）

### 总链路

```text
PlannerAgent.plan() 每一轮 step：
  llm.plan()
  → emit planner_decision (SSE)
  → 可选 Tool.execute → tool_start / tool_end (SSE)
  → recordPlannerStep + recordToolCall
  → llm.answerWithTool → token (SSE)
```

### 读代码（45 分钟）

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `apps/api/src/agents/planner-agent.ts` | 类头注释；`plan()` for 循环 |
| 2 | 同上 | `recordStep` vs `recordToolCall` 分工 |
| 3 | 同上 | 工具成功后 `answerFromToolResult` + break（跳过第二轮 plan） |
| 4 | `apps/api/src/llm/llm-client.ts` | 三次调用：plan / answerWithTool / summarizeSession |
| 5 | `apps/api/src/llm/hunyuan-llm-client.ts` | function calling；stream: true 分支 |
| 6 | `apps/api/src/runtime/agent-stream.ts` | `emitPlannerDecision`、`createTokenHandler` |
| 7 | `packages/api-contract/src/stream-events.ts` | SSE 事件名枚举 |

### 手测 A：SSE 流式 + time 工具（25 分钟）

```bash
curl -N -s -X POST http://localhost:3000/agent/stream \
  -H 'content-type: application/json' \
  -d '{"input":"请调用 time 工具告诉我现在时间"}'
```

**期望事件顺序（大致）：**

```text
planner_decision (needsTool: true, toolName: time)
tool_start
tool_end (status: succeeded)
token（若干）
done
```

记下 `taskId`（`done` 事件里），然后：

```bash
pnpm run task:replay -- <taskId>
```

对比 replay 输出里 **`plannerTrace`**（决策）与 **`toolCalls`**（执行）。

### 手测 B：直答无工具（15 分钟）

```bash
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"1+1等于几？直接回答"}' | jq .

pnpm run task:replay -- <taskId>
# plannerTrace outcome 应为 direct_answer；toolCalls 为空
```

### 手测 C：断点调试（可选 20 分钟）

1. F5 **API: Debug HTTP Server**（确认 `HTTP server started`）
2. 断点：`planner-agent.ts` 的 `emitPlannerDecision` 后、`tool.execute` 前
3. curl 触发 time 工具请求，单步观察 `decision` 对象

### Day 2 自检

- [ ] 能画出带工具时 SSE 事件顺序
- [ ] 能解释 `plannerTrace[].outcome` 几种典型值（`direct_answer`、`tool_executed`）
- [ ] 知道 `toolCalls` 只在工具**实际 execute** 后才有
- [ ] 会用 `task:replay` 读一条任务的决策链

### Day 2 学习要点

**过程看 SSE，审计看 DB。** `plannerTrace` 是「模型想干什么」；`toolCalls` 是「工具真跑了什么」。

---

## Day 3：Session 上下文（summary + recent window）

**时间：** 1.5–2h  
**目标：** 搞清长会话如何压 summary、最近 N 条如何进 prompt。

### 总链路

```text
有 sessionId 的 run：
  buildSessionContext()
    → listAllSessionMessages
    → 切分 older / recent window
    → 若 older 未覆盖：llm.summarizeSession → 写 sessions.summary
    → plan / answer 时注入 summary + recentHistory
```

### 读代码 + 文档（40 分钟）

| 顺序 | 资源 | 看什么 |
|------|------|--------|
| 1 | `docs/session-context.md` | `SESSION_HISTORY_*` 两个 env |
| 2 | `planner-agent.ts` | `buildSessionContext` 全文 |
| 3 | 同上 | `summaryMessageCount` 增量总结逻辑 |
| 4 | 同上 | `toLlmConversationMessages`（排除当前 task） |
| 5 | `hunyuan-llm-client.ts` | `summarizeSession` |
| 6 | `postgres-memory-store.ts` | `updateSession` 写 summary 字段 |

### 手测 A：手动多轮记忆（25 分钟）

```bash
# 第一轮
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请记住：我喜欢东京。只回复收到。"}' \
  | tee /tmp/day3-run1.json | jq .

export SESSION_ID=$(jq -r .sessionId /tmp/day3-run1.json)

# 第二轮（同 session）
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d "{\"input\":\"我刚才说我喜欢哪里？\",\"sessionId\":\"$SESSION_ID\"}" \
  | jq .result.summary

# 看 summary 是否写入
curl -s http://localhost:3000/sessions/$SESSION_ID | jq '{
  summary: .session.summary,
  summaryMessageCount: .session.summaryMessageCount
}'
```

### 手测 B：eval 回归（15 分钟）

```bash
pnpm run evals:run
# 重点看 case：session-memory-city
```

失败时用报告里的 `taskId` → `task:replay`。

### 手测 C：读 DB（可选 10 分钟）

```bash
pnpm run db:inspect
# 或 SQL：select id, summary, summary_message_count from sessions where id = '<SESSION_ID>';
```

### Day 3 自检

- [ ] 能解释「summary + recent window」为什么这样设计
- [ ] 知道 `summarizeSession` 在 **plan 之前** 调用
- [ ] 能用手动 curl 复现同 session 追问
- [ ] eval `session-memory-city` 通过或能解释失败原因

### Day 3 学习要点

**Session 是容器，Task 是单次 run，Message 是落库行。** 上下文 = 压缩旧历史 + 保留最近原文。

---

## Day 4：Eval 回归 + 故意改坏

**时间：** 1.5–2h  
**目标：** 把 eval 当 Agent 的「端到端单元测试」；会读报告 + replay 排查。

### 读代码（30 分钟）

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `apps/api/evals/cases/basic-agent-cases.json` | 11 条 case 分类（工具/安全/记忆） |
| 2 | `apps/api/src/scripts/run-evals.ts` | 断言逻辑：expectedTools、expectedKeywords、expectedErrorCode |
| 3 | `docs/evals-and-replay.md` | 用例格式、报告路径 |

### 手测 A：全量 eval（20 分钟）

```bash
pnpm run evals:run
# 报告：apps/api/evals/reports/eval-run-*.json
```

**当前基线（2026-07-06）：** 11 条中约 9 pass。已知 2 条 read_file 安全 case 可能因**模型未调工具、仅文字拒绝**而 task 仍 succeeded——巩固周**观察即可**，Week 结束再决定是否修 prompt/断言。

| case id | 测什么 |
|---------|--------|
| `time-query` | 调 time |
| `doc-summary` | http_fetch + 关键词 |
| `direct-answer` / `greet-no-tools` | 不调工具 |
| `blocked-localhost` / `blocked-private-host` | http_fetch SSRF |
| `session-memory-city` | 多轮 session 记忆 |
| `read-file-fixture` | read_file 正常读 |
| `blocked-read-*` | read_file 路径安全 |

### 手测 B：故意改坏（40 分钟）

1. 打开 `hunyuan-llm-client.ts` 的 plan system prompt
2. **临时删除**「If the user asks for current date or time, call the time tool」一句
3. 再跑 `pnpm run evals:run` → 预期 `time-query` fail
4. 打开报告，拿 `taskId` → `pnpm run task:replay -- <taskId>`
5. 看 `plannerTrace` 的 `outcome: direct_answer` 而非 `tool_executed`
6. **改回 prompt**，eval 再跑至恢复

可选：F5 **API: Debug Evals**，断点在断言失败处。

### Day 4 自检

- [ ] 能解释 eval 报告里 pass/fail 原因字段
- [ ] 会从 fail case 的 `taskId` 走到 replay
- [ ] 做过一次「改 prompt → eval 红 → 还原 → 绿」

### Day 4 学习要点

Eval 测的是**端到端行为**，不是 mock LLM。失败先看 `plannerTrace` / `toolCalls`，再改 prompt 或工具。

---

## Day 5：Memory 层 + 安全工具 + 总自检

**时间：** 1.5–2h  
**目标：** 五张表读写心中有数；工具安全在 Tool 层 enforce。

### 读代码（45 分钟）

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `apps/api/src/memory/memory-store.ts` | 接口：五类操作 |
| 2 | `apps/api/src/memory/persistence-model.ts` | TS 类型 vs DB 表 |
| 3 | `apps/api/src/memory/postgres-memory-store.ts` | createSession、append、recordPlannerStep、listAllSessionMessages |
| 4 | `apps/api/src/tools/http-fetch-tool.ts` | `validateUrl` 内网拦截 |
| 5 | `apps/api/src/tools/read-file-tool.ts` | `resolveSafePath` 沙箱 |
| 6 | `apps/api/src/config/env.ts` | `READ_FILE_*`、`HTTP_FETCH_*` |

### 五张表速查

| 表 | 写什么 | 谁写 |
|----|--------|------|
| `sessions` | summary、status、last_task_at | prepareAgentRun / TaskRunner / buildSessionContext |
| `tasks` | input、status、summary、error | TaskRunner |
| `messages` | user/assistant/tool 内容 | TaskRunner、PlannerAgent |
| `tool_calls` | 工具 input/output | PlannerAgent 工具分支 |
| `planner_steps` | 每轮 plan 决策 outcome | PlannerAgent `recordStep` |

### 手测（30 分钟）

```bash
# 安全：http 内网
pnpm run evals:run   # 看 blocked-localhost、blocked-private-host

# 安全：read_file 越界（观察模型 vs Tool 层差异）
pnpm run evals:run   # 看 blocked-read-env-traversal、blocked-read-absolute-path

# 正常 read_file
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 read_file 读取 sample-notes.txt，告诉我提到的城市"}' | jq .
```

### 巩固周总自检

- [ ] 能不看代码说出 `POST /agent/run` 到落库的完整步骤
- [ ] 能解释 `plannerTrace` vs `toolCalls` vs `messages`
- [ ] 能用手动 curl 复现 session 记忆
- [ ] 跑过全量 eval，知道 pass/fail 含义
- [ ] 会用 `task:replay` 排查失败 task
- [ ] 知道 TokenHub：`hy3-preview` + `tokenhub.tencentmaas.com/v1` + TokenHub Key 三者配套
- [ ] 知道调试用 F5 时必须看到 `HTTP server started`
- [ ] （可选）读过 `postgres-memory-store.ts` 五个核心方法

---

## 巩固周结束后：E.6 方向（三选一）

| 方向 | 学什么 | 适合 |
|------|--------|------|
| **A. 扩 eval** | 回归基线、改坏实验 | 求稳 |
| **B. 新工具** | Tool 注册、安全、prompt | 练「加能力」全流程 |
| **C. 轻量 RAG** | 检索 + 工具 + 上下文 | 对齐 `learning-plan` 练习 2 |

选定后在 `docs/current-status.md` 开 E.6 条目再动手。

---

## 常见问题

### 前端 `Failed to fetch`

**原因：** 浏览器连不上 `http://localhost:3000`（后端未 listen）。

**排查：**

```bash
curl -s http://127.0.0.1:3000/health | jq .
```

- Connection refused → 启动 `dev:server` 或 F5 Debug，等到 `HTTP server started`
- Debug 时若工具栏暂停 → Continue（F5）

### `401 invalid api key`

TokenHub Key 与旧混元 Key 不通用。检查 `apps/api/.env`：

```bash
HUNYUAN_MODEL=hy3-preview
HUNYUAN_BASE_URL=https://tokenhub.tencentmaas.com/v1
HUNYUAN_API_KEY=<TokenHub 控制台创建的 Key>
```

### eval 11 条未全绿

先看报告 `failures` 和 `taskId`。read_file 安全 case 若模型「口头拒绝」而未调工具，属于 **LLM 行为 vs Tool enforce** 差异——巩固周记录现象即可，不必强行修代码。

---

## 相关文档

| 文档 | 用途 |
|------|------|
| `docs/current-status.md` | 进度状态源 |
| `docs/http-api.md` | API 字段与示例 |
| `docs/session-context.md` | summary + window 策略 |
| `docs/evals-and-replay.md` | eval 格式与 replay |
| `docs/web-setup.md` | 前端手测（可选） |
| `.vscode/launch.json` | 后端调试配置 |
| `.cursor/rules/backend-first-learning.mdc` | 后端优先学习规则 |
