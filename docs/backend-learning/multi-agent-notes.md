# Multi-Agent（E.12）：Supervisor + 专家

> 进度见 [`docs/current-status.md`](../current-status.md) §E.12。  
> 本文解释 **多 Agent 实质**、路由可观测点，以及 **怎么测、怎样算对**。

## 要解决什么问题

单 `PlannerAgent` + 全量工具：一个大脑看见所有工具，容易串台（搜文档时误调 `write_file`）。

E.12 把决策拆成两层：

1. **Supervisor**：只分诊，选 `docs` / `files` / `general`
2. **专家 Planner**：带**工具子集**跑完整 `plan()` 循环

```text
用户 input
  → Supervisor.routeSpecialty（LLM 分诊）
  → planner_steps step1 outcome=routed, toolName=专家 id
  → PlannerAgent(tools=子集, stepOffset=1)
  → 后续 step 写 tool_executed / direct_answer …
  → TaskRunner 收尾
```

## 概念对照

| 词 | 是什么 | 不是什么 |
|----|--------|----------|
| **Supervisor** | 编排者：只路由一次 | 不自己读文件 / 搜文档 |
| **专家** | 带受限工具包的完整 Agent 循环 | 不是「给工具贴标签」那么简单——决策上下文也被收窄 |
| **`routed`** | `plannerTrace` 里分诊一步 | 不是真实 `tool_calls` 行 |
| **`general`** | 全量工具；不确定意图必须落这里 | 不是「第四种业务专家」 |

专家工具子集（装配见 `create-agent-runtime.ts`）：

| 专家 | 工具 | 典型意图 |
|------|------|----------|
| `docs` | `search_docs`, `read_file`, `list_dir` | 文档检索 / 问答 |
| `files` | `list_dir`, `read_file`, `write_file` | 沙箱读写 / 列目录 |
| `general` | **全部** | 时间、HTTP、echo、wait、拿不准 |

## 和单 Agent 的差别（怎么从数据上看出来）

| | `AGENT_ORCHESTRATION=single` | `supervisor`（默认） |
|--|------------------------------|----------------------|
| 顶层 `agent` | `PlannerAgent` | `SupervisorAgent` |
| `plannerTrace[0]` | 通常直接 `tool_executed` / `direct_answer` | **`outcome=routed`**，`toolName`=`docs\|files\|general` |
| 真实工具步 | 从 step 1 起 | 从 **step 2** 起（`stepOffset=1`） |
| 多一次 LLM | 无 | `purpose=route`（计入 `metrics.llmCallCount`） |

## 误路由与本版边界

`docs` 与 `files` 会重叠（都要碰文件）。本版是 **route-once**：分错了**不会**运行中热转到另一专家。

缓冲：

1. 拿不准 → `general`
2. 路由 prompt 写互斥规则
3. `plannerTrace` 可观测分错了

后期（E.12.x）才做 handoff / 升级 general。详见进度文档与计划。

## 环境开关

```bash
# 默认（.env.example）
AGENT_ORCHESTRATION=supervisor

# 对比 / 救急：关掉多 Agent，行为接近 E.11 前
AGENT_ORCHESTRATION=single
```

`multi-route-*` case 带 `requiresOrchestration: ["supervisor"]`，在 `single` 下会**跳过**（不是 fail）。

---

## 怎么测、怎样算对

### A. 类型检查（必过）

```bash
pnpm run check:all
```

**算对：** 退出码 0。

### B. Multi-Agent 专用 eval（主验收）

前置：Postgres 已起、已 migrate；`.env` 有 Key；`AGENT_ORCHESTRATION` 不要设成 `single`（默认即可）。

```bash
pnpm run evals:run -- --id multi-route-docs
pnpm run evals:run -- --id multi-route-files
pnpm run evals:run -- --id multi-route-general
```

| case | 路由算对 | 工具算对 | 回答算对 |
|------|----------|----------|----------|
| `multi-route-docs` | `expectedRoutedAgent=docs` | 用了 `search_docs` | summary 含 `Taipei` |
| `multi-route-files` | `files` | 用了 `list_dir` | summary 含 `sample-notes.txt` |
| `multi-route-general` | `general` | 用了 `time` | （无强制关键词） |

**算对（每条）：**

1. 报告里 `"passed": true`，`"failures": []`
2. 日志有 `Supervisor routed to specialist` 且 `specialistId` 与上表一致
3. 断言层：`plannerTrace` 存在 `outcome=routed` 且 `toolName` = 期望专家（由 `run-evals` 自动查 DB）

**不算对的典型 fail：**

| failures 文案 | 含义 | 怎么办 |
|---------------|------|--------|
| `Expected routed agent "docs" but … general` | 分诊偏保守/文案不够硬 | 强化 case 文案或路由 prompt |
| `Expected tool "search_docs" was not used` | 专家对了但没调工具 | 看 `plannerTrace` 后续步 |
| `Forbidden tool … was used` | 调了不该出现的工具 | 查专家子集是否装错 |

### C. 用 replay 肉眼验收（推荐每条 eval 后做一次）

注意：`--` 后面有**空格**，taskId **不要**再加 `--`。

```bash
# 从 eval 报告抄 taskId
pnpm run task:replay -- eval-multi-route-docs-<时间戳>
```

**算对（docs 例）：**

```json
"plannerTrace": [
  { "step": 1, "outcome": "routed", "tool_name": "docs" },
  { "step": 2, "outcome": "tool_executed", "tool_name": "search_docs" }
]
```

- step 1：**只有** `routed`，没有对应 `tool_calls` 行叫 `docs`
- step 2：才有真实 `tool_calls`（如 `search_docs`）
- `metrics.llm_call_count` ≥ 3（route + plan + answer）；`llm_calls` 里应有 `purpose: "route"`

### D. 可选：HTTP 手测

```bash
# 起 API 后
curl -s http://127.0.0.1:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 search_docs 搜索 favorite city，直接回答城市名。"}' | jq .

TASK_ID='<上一步返回的 taskId>'
curl -s "http://127.0.0.1:3000/tasks/$TASK_ID" | jq '.plannerTrace[0], .toolCalls'
```

**算对：** `plannerTrace[0].outcome === "routed"`；`toolCalls` 里有业务工具，没有名为 `docs` 的假工具调用。

### E. 全量回归（合并前建议）

```bash
pnpm run evals:run
```

**算对：** `failed: 0`。keyword 模式下约 **28** 条（跳过 `search-docs-city-zh`；含 3 条 multi-route）。  
旧 case 若偶发因误路由变差：先 `task:replay`；拿不准应落 `general`，一般仍有全量工具可用。

### F. 对照实验（可选）

```bash
AGENT_ORCHESTRATION=single pnpm run evals:run -- --id multi-route-docs
```

**算对：** 该 case 被 **skip**（输出里没有这条 / 或 total 不含它），而不是硬 fail。  
再跑 `time-query` 应仍绿，且 `plannerTrace` **没有** `routed`。

---

## 代码怎么读

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `agents/supervisor-agent.ts` | 路由 → 落 `routed` → 委托 Planner |
| 2 | `llm/hunyuan-llm-client.ts` `routeSpecialty` | 分诊 prompt 与 `plan` 分离 |
| 3 | `app/create-agent-runtime.ts` | 专家工具子集 + `AGENT_ORCHESTRATION` |
| 4 | `agents/planner-agent.ts` | `stepOffset` |
| 5 | `scripts/run-evals.ts` | `expectedRoutedAgent` / `requiresOrchestration` |

心智模型：`分诊 LLM → routed 可观测 → 专家小工具箱跑 plan → 旧 eval 仍尽量绿`。
