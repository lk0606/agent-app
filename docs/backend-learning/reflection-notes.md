# Reflection（E.15）：怎么学、怎么看代码

> 进度见 [`docs/current-status.md`](../current-status.md) §E.15。  
> 本文对应「未提交的 E.15 代码如何学习」：读码顺序、文件职责、坑点与验证命令。

未提交改动几乎就是 **E.15 Reflection（定稿自检）一整条业务**，外加接线（env / runtime / 契约 / eval / 文档）。不是另一套无关功能。

---

## 1. 先建立心智模型（5 分钟）

改前（纯 ReAct）：

```text
plan → (tool)* → 草稿 answer → 直接结束
```

改后（开 `AGENT_REFLECTION=true`）：

```text
plan → (tool)* → 草稿 answer
  → reflect（虚拟 function：accept_draft | revise_plan）
  → pass：记 reflection_passed，交稿
  → retry：记 reflection_retry，critique 回灌下一轮 plan
```

关键约束：

- Reflection **不执行业务工具**，只审草稿
- `accept_draft` / `revise_plan` **不会进 `tool_calls` 表**
- 它们会出现在 `plannerTrace`（`planner_steps`）和 `metrics.llmCalls[purpose=reflect]`

---

## 2. 文件按「角色」分组

| 角色 | 文件 | 学什么 |
|------|------|--------|
| 开关接线 | `apps/api/src/config/env.ts`、`apps/api/.env.example`、`apps/api/src/app/create-agent-runtime.ts` | 配置怎么进 Planner |
| 接口契约 | `apps/api/src/llm/llm-client.ts`、`packages/api-contract/src/schemas.ts`、`apps/api/src/memory/persistence-model.ts` | 类型 / outcome 长什么样 |
| LLM 实现 | `apps/api/src/llm/hunyuan-llm-client.ts` 的 `reflect()` | 怎么问模型、怎么解析 |
| 编排核心 | `apps/api/src/agents/planner-agent.ts` | 何时审、审完怎么 continue |
| 落库 / 指标 | `apps/api/src/memory/postgres-memory-store.ts`、`apps/api/src/runtime/task-metrics.ts` | outcome / purpose 能否存 |
| 回归 | `apps/api/src/scripts/run-evals.ts`、`apps/api/evals/cases/basic-agent-cases.json` | 怎么断言 A/B |
| 文档 | `docs/current-status.md` E.15、`docs/evals-and-replay.md` | 验收口径 |

Cursor 规则 `.cursor/rules/explain-with-examples.mdc` 与本业务无关，可读可不读。

---

## 3. 推荐阅读顺序（带看什么）

### Day 1：契约 → 开关 → 接口（约 30–40 分钟）

**① `packages/api-contract/src/schemas.ts`**

- 搜 `reflection_passed` / `reflection_retry` / `purpose` 含 `reflect`
- 搞清：这是 API / 前端可见的枚举，不是随便字符串

**② `apps/api/src/config/env.ts` + `apps/api/.env.example`**

- `AGENT_REFLECTION`（默认 true）
- `AGENT_REFLECTION_MAX_RETRIES`（默认 1）
- `AGENT_MAX_STEPS` 提到 5（错工具 → 再 plan 至少要 2 轮余量）
- 旁注：`maxSteps` ≠ `toolCallBudget` ≠ plannerTrace 行数

**③ `apps/api/src/app/create-agent-runtime.ts`**

- 看 `reflectionEnabled` / `reflectionMaxRetries` 如何塞进 `PlannerAgent` 构造

**④ `apps/api/src/llm/llm-client.ts`**

重点三段：

| 符号 | 含义 |
|------|------|
| `PlanRequest.reflectionFeedback` | 上一轮 critique，喂给下一轮 plan |
| `ReflectRequest` | 用户问题 + 草稿 + 已执行工具证据 |
| `LlmClient.reflect` | 接口；实现在 Hunyuan |

读完应能回答：Reflection 的输入输出是什么，和 `plan` 差在哪。

---

### Day 2：LLM 实现（约 40 分钟）

**⑤ `hunyuan-llm-client.ts` → `reflect()`（约 425–565 行）**

按分支读：

| 步骤 | 看什么 |
|------|--------|
| 拼 `toolDigest` | 无工具 / 有工具两种形态；不信任工具走 E.14 隔离包装 |
| system prompt | 「宁可 revise，不要编造已调 time」——直接服务 `reflection-echo-then-time` |
| 两个虚拟 function | `accept_draft`（可空 critique）/ `revise_plan`（必填 critique） |
| 解析形态 A/B/C | accept → `accepted:true`；revise → `false`；没选 function → **保守 accept**（防卡死） |
| `finally` | `emitLlmCall(..., "reflect", ...)` → 进 `task_metrics` |

再跳到同文件里 `plan()` 拼 prompt 处，搜 `reflectionFeedback`：拒绝后下一轮 plan 如何把 critique 写进消息。

---

### Day 3：Planner 编排（最重要，约 60–90 分钟）

**⑥ `planner-agent.ts`——先文件头，再主循环，再私有方法**

**A. 文件头（约 27–54 行）**  
跨模块顺序 + `[1]…[5]` 索引；确认 Reflection 挂在「草稿之后、真正结束之前」。

**B. `plan()` 开头状态（约 60–97 行）**

```text
stepCursor / allocateStep     ← reflection 也占 step，不能再用「循环下标硬算」
reflectionFeedback            ← 回灌 critique
reflectionRetryCount          ← 对比 maxRetries
reflectionEnabled             ← 未传当 true
```

**C. 主循环里所有 `finalizeDraftWithReflection` 调用点**（搜这个名字）

每处都是「草稿已生成，准备结束」的钩子。典型路径：

| 场景 | 行为 |
|------|------|
| `direct_answer` 后 | 审一遍；`accepted` 才 `break`，否则 `continue` 再 plan |
| 工具成功并 `answerWithTool` 后 | 同上 |
| `budget_exceeded` | 仍审一次，但 `maxRetries: 0` → 拒绝也强制交稿 |
| fallback 路径 | 同样兜底，避免死循环 |

同时注意：开反思时草稿往往 **先不 SSE**，通过后才推最终答案（避免先流错误答案）。

**D. `[4] finalizeDraftWithReflection`（约 840–950 行）——精读**

| 形态 | 条件 | 结果 |
|------|------|------|
| 0 | `!reflectionEnabled` | 不调 LLM，直接 `return true` |
| A | `accepted` 或预算用尽强制交 | 落 `reflection_passed`；强制时 `errorCode=REFLECTION_BUDGET_EXCEEDED` |
| B | 拒绝且还有预算 | 落 `reflection_retry`，`errorMessage=critique`，setter 更新 feedback/count，`return false` |

读完应能手绘：`echo → reflection_retry → time → reflection_passed` 的 step 号变化。

---

### Day 4：落库 + eval（约 40 分钟）

**⑦ `persistence-model.ts`**  
看 outcome 联合类型是否含 `reflection_*`，以及注释里「critique 放 errorMessage」的约定。

**⑧ `postgres-memory-store.ts` / `task-metrics.ts`**  
确认新 outcome、`purpose=reflect` 能写入、不被旧校验挡掉。

**⑨ `evals/cases/basic-agent-cases.json` 末尾两条**

| case | 开反思期望 | 关反思期望 |
|------|------------|------------|
| `reflection-time-accept` | `time` + `reflection_passed` | 无 `reflection_passed` |
| `reflection-echo-then-time` | `echo`→`retry`→`time`→`passed` | 至少先到 `echo`，且无 `reflection_*` |

**⑩ `scripts/run-evals.ts`**

- `expectedPlannerOutcomes` / `requiresReflection` / `expectedToolsWhenReflectionOff`
- A/B 逻辑：同一 outcome 列表，**开时必须出现，关时必须都不出现**

---

### Day 5：文档收口（可选 15 分钟）

**⑪ `docs/current-status.md` → E.15**  
对照「已交付 / 学习要点 / 代码怎么读」，和你上面读过的是否一致。

---

## 4. 建议学习节奏（可复制）

```bash
# 1）类型检查（不烧 LLM）
pnpm --filter @agent-app/api check

# 2）专项 eval（需 postgres + .env 里 AGENT_REFLECTION=true）
pnpm run evals:run -- --id reflection-time-accept
pnpm run evals:run -- --id reflection-echo-then-time

# 3）A/B：关反思应看不到 reflection_* outcome
AGENT_REFLECTION=false pnpm run evals:run -- --id reflection-echo-then-time

# 4）失败时用返回的 taskId 回放
pnpm run task:replay -- <taskId>
```

手测看决策链：

```bash
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"现在几点了？请调用 time 工具一句话回答。"}' \
  | jq '{summary: .result.summary, taskId}'

# 再：
curl -s http://localhost:3000/tasks/<taskId> \
  | jq '[.plannerTrace[] | {step, outcome, toolName, errorMessage}]'
```

期望至少出现：`tool_executed(time)` + `reflection_passed`。

---

## 5. 读代码时盯的 5 个「坑点」

1. **Reflection ≠ 又一次 plan**：不调 `time`/`echo`，只调 `llm.reflect`。
2. **step 游标**：reflection 占 step，所以 step 数可以大于 `maxSteps` 循环次数。
3. **预算用尽仍审一次**：`maxRetries: 0` ≠ 关反思；关反思是 `reflectionEnabled=false`。
4. **解析失败保守 accept**：形态 C，防反思把任务卡死。
5. **三种追踪别混**：`plannerTrace.outcome=reflection_*` ≠ `metrics.purpose=reflect` ≠ 分布式 `traceId`。

---

## 6. 一条「跟读清单」（最短路径）

若今天只想走通主链，按这个顺序打开即可：

1. `llm-client.ts`：`ReflectRequest` / `reflect`
2. `hunyuan-llm-client.ts`：`reflect()` 全函数
3. `planner-agent.ts`：`plan` 里第一处 `finalizeDraftWithReflection` + 方法本体
4. `basic-agent-cases.json`：两条 `reflection-*`
5. 跑两条 eval + 一次 `task:replay`

---

## 7. 例子

**专业例子：** 跑 `reflection-echo-then-time` 时，先在 `plannerTrace` 看到 `tool_executed(echo)`，再 `reflection_retry`（`errorMessage` 含改用 time 的 critique），再 `tool_executed(time)`，最后 `reflection_passed`；同时 `metrics.llmCalls` 里会出现至少一次 `purpose=reflect`。

**非专业例子：** 像写作业先交一稿，老师批「工具用错了」贴回本子（critique），你改一版再交；老师只批改、不替你做题——这就是 Reflection 相对业务 Tool 的位置。
