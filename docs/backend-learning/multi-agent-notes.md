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
| `plannerTrace[0]` | 通常直接 `tool_executed` / `direct_answer` | **`outcome=routed`**，`toolName`=`docs\|files\|general`；受限专家还可写 `escalated/general` |
| 真实工具步 | 从 step 1 起 | 从 **step 2** 起（`stepOffset=1`） |
| 多一次 LLM | 无 | `purpose=route`（计入 `metrics.llmCallCount`） |

## 专家升级：受限工具箱不够时怎么办

这里的“升级”是：`docs` 或 `files` 专家需要自己工具箱外的能力时，改派给 `general`。它不是业务工具调用，也不会产生 `tool_calls`。

本版规则：

1. 只允许 `docs/files → general`，不支持任意专家互转。
2. 每个任务最多升级一次；`general` 已有全量工具，不能再次升级，避免路由循环。
3. 升级后 `general` 可在工具预算内继续规划剩余步骤。
4. 后端支持三种升级触发形态：模型显式选择 `escalate_to_general`；模型选了“当前子集没有、但 general 有”的业务工具；或用户直接点名了仅 general 有的工具。后两种由 Planner 自动升级，避免模型漏选内部 function 或误调别的工具后失败。
5. 用户若直接按顺序点名工具，连续规划下一轮只向模型暴露尚未完成的一项；例如 `time → write_file` 中 `time` 成功后，本轮只提供 `write_file`。这是因为 TokenHub 模型只支持 `tool_choice="auto"`，不能指定某个 function。重复工具排除仍是模型未按要求执行时的兜底。

示例：用户要求“先调用 `time`，再调用 `write_file` 写入沙箱文件”。初始路由因写文件进入 `files`；`files` 没有 `time`，请求升级；`general` 先只看到 `time`，成功后只看到 `write_file`。若模型仍返回重复工具，Planner 也会排除它后再规划。

`plannerTrace` 会留下三条控制记录：

```text
routed/files → escalated/general → routed/general
```

- `escalated/general`：受限专家提出升级请求；
- 后面的 `routed/general`：Supervisor 接受请求并实际改派；
- 两者之间没有名为 `general` 的真实工具调用。

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
pnpm run evals:run -- --id multi-escalate-files-to-general
```

| case | 路由算对 | 工具算对 | 回答算对 |
|------|----------|----------|----------|
| `multi-route-docs` | `expectedRoutedAgent=docs` | 用了 `search_docs` | summary 含 `Taipei` |
| `multi-route-files` | `files` | 用了 `list_dir` | summary 含 `sample-notes.txt` |
| `multi-route-general` | `general` | 用了 `time` | （无强制关键词） |
| `multi-escalate-files-to-general` | `files → general` | `time → write_file` | 时间已写入 `handoff-time.txt` |

**算对（每条）：**

1. 报告里 `"passed": true`，`"failures": []`
2. 日志有 `Supervisor routed to specialist` 且 `specialistId` 与上表一致
3. 断言层：`plannerTrace` 存在 `outcome=routed` 且 `toolName` = 期望专家（由 `run-evals` 自动查 DB）
4. 升级 case 还要求 `escalated/general` 后紧跟更高 step 的 `routed/general`；`general` 不可再次升级

**不算对的典型 fail：**

| failures 文案 | 含义 | 怎么办 |
|---------------|------|--------|
| `Expected routed agent "docs" but … general` | 分诊偏保守/文案不够硬 | 强化 case 文案或路由 prompt |
| `Expected tool "search_docs" was not used` | 专家对了但没调工具 | 看 `plannerTrace` 后续步 |
| `Forbidden tool … was used` | 调了不该出现的工具 | 查专家子集是否装错 |
| `Expected one escalation to general …` | 专家没请求升级，或 Supervisor 没完成二次路由 | 对照 `plannerTrace` 的 `escalated` / `routed` 顺序 |

### C. 用 replay 肉眼验收（推荐每条 eval 后做一次）

注意：`--` 后面有**空格**，taskId **不要**再加 `--`。

```bash
# 从 eval 报告抄 taskId
pnpm run task:replay -- eval-multi-route-docs-<时间戳>
```

**算对（升级例）：**

```json
"plannerTrace": [
  { "step": 1, "outcome": "routed", "tool_name": "files" },
  { "step": 2, "outcome": "escalated", "tool_name": "general" },
  { "step": 3, "outcome": "routed", "tool_name": "general" },
  { "step": 4, "outcome": "tool_executed", "tool_name": "time" },
  { "step": 5, "outcome": "tool_executed", "tool_name": "write_file" }
]
```

- step 1 / 3 是 Supervisor 的路由决定；step 2 是专家的升级请求，三者都没有对应 `tool_calls`
- step 4 / 5 才有真实 `tool_calls`
- `metrics.llm_call_count` ≥ 4（route + 受限专家 plan + general plan + answer）；`llm_calls` 里应有 `purpose: "route"`

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

**算对：** `failed: 0`。keyword 模式下约 **29** 条（跳过 `search-docs-city-zh`；含 3 条路由 + 1 条升级 case）。
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
| 1 | `agents/supervisor-agent.ts` | 初次路由、捕获升级、二次路由 general |
| 2 | `agents/planner-agent.ts` | 升级控制信号、`stepOffset`、general 连续规划 |
| 3 | `llm/hunyuan-llm-client.ts` | 分诊 prompt、`escalate_to_general` function |
| 4 | `app/create-agent-runtime.ts` | 专家工具子集 + `AGENT_ORCHESTRATION` |
| 5 | `scripts/run-evals.ts` | `expectedRoutedAgent` / `expectedEscalationToGeneral` |

心智模型：`分诊 LLM → routed → 受限专家请求升级 → escalated → Supervisor 改派 general → 全量工具继续 plan`。
