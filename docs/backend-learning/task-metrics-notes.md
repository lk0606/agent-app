# 任务观测与成本统计（E.9）

> 进度见 [`docs/current-status.md`](../current-status.md) §E.9。  
> 本文解释 **task metrics** 与 `plannerTrace` / `traceId` 的差别，以及数据从哪来。

## 本次重难点理解（先看）

E.9 真正难的不是公式，而是**别把三种「追踪」混成一个词**：

| 你的说法（对） | 更精确一点 | 本仓库现状 |
|----------------|------------|------------|
| `metrics` ≈ 计费/用量追踪 | **任务级**耗时 + token + **估算**成本 | ✅ 已实现（`task_metrics`） |
| `plannerTrace` ≈ 规划追踪 | 每轮 plan：**要不要工具、选哪个、outcome** | ✅ 已实现（`planner_steps`） |
| `traceId` ≈ 所有服务请求的 id 追踪 | **跨服务/跨进程**把一次请求串成调用链 | ❌ 未实现（文档预留） |

**重难点 1：同一次任务会同时有 `taskId` + `metrics` + `plannerTrace`，但职责不同。**  
问「贵不贵 / 慢不慢」→ `metrics`；问「为啥调了 time」→ `plannerTrace`；问「请求跨了几个微服务」→ 将来才用 `traceId`。

**重难点 2：`metrics` 不是 Cursor Usage 那种账单台账。**  
用量来自混元响应 `usage`（token，不是字符数）；费用用 env 占位单价**当场估算一次**写入，**不会**把历史行拿出来用新单价重算。

**重难点 3：单 Node 进程里，业务关联键用 `taskId` 就够；不要急着上 `traceId`。**  
`traceId` 要等「HTTP → 队列 → 另一服务 → DB」这种跨边界排障时才真正有价值。

---

## 要解决什么问题

Agent 跑完后你要能回答：

- 这次任务花了多久？
- 打了几次 LLM？prompt / completion 各多少 token？
- 按配置单价估算大概多少钱？
- 哪一次 `plan` / `answer` / `summarize` 最慢或最贵？

这些都不该靠翻日志肉眼估算，而要**按 taskId 落库聚合**。

---

## 三者展开：metrics / plannerTrace / traceId

### 一句话对照

```text
metrics      → 「这次任务花了多少资源」（慢/贵/打了几次 LLM）
plannerTrace → 「这次任务怎么决策的」（要不要工具、outcome）
traceId      → 「这次请求在分布式系统里走过哪些服务」（本仓库未做）
```

### 同一任务的示例（用户说：查一下现在几点）

假设 `POST /agent/run`，`taskId = task-001`，模型调了 `time` 再回答。

#### 1）`plannerTrace` —— 规划追踪（已有）

回答：**为什么调了 time？走了几步 plan？**

```json
[
  {
    "step": 1,
    "needsTool": true,
    "toolName": "time",
    "outcome": "tool_executed",
    "durationMs": 900
  },
  {
    "step": 2,
    "needsTool": false,
    "toolName": null,
    "outcome": "direct_answer",
    "durationMs": 1200
  }
]
```

表：`planner_steps`。  
这里**看不到**花了多少钱；只看决策链。

#### 2）`metrics` —— 用量 / 估算成本追踪（E.9）

回答：**一共打了几次 LLM？多少 token？估算多少钱？总耗时？**

```json
{
  "taskId": "task-001",
  "durationMs": 3286,
  "llmCallCount": 2,
  "promptTokens": 1271,
  "completionTokens": 46,
  "totalTokens": 1317,
  "toolCallCount": 1,
  "plannerStepCount": 2,
  "estimatedCostUsd": 0.0007045,
  "llmCalls": [
    { "purpose": "plan", "promptTokens": 1176, "completionTokens": 19, "durationMs": 1802 },
    { "purpose": "answer", "promptTokens": 95, "completionTokens": 27, "durationMs": 1366 }
  ]
}
```

表：`task_metrics`。  
注意：`toolCallCount` / `plannerStepCount` 是结束时从 `tool_calls` / `planner_steps` **数行数**填进去的，不是重算费用。

野路子：`metrics` 更像「这次任务的资源账单草稿」；不是「模型脑子里怎么想的」。

#### 3）`traceId` —— 分布式请求追踪（未实现）

回答：**这个 HTTP 请求经过了 API、队列、另一个 worker、第三方 LLM 网关分别花了多久？哪一跳报错？**

假想未来长这样（本仓库现在没有）：

```text
traceId = T-abc
  span HTTP /agent/run          3.2s
    span TaskRunner             3.1s
      span LLM plan             1.8s
      span tool time            1ms
      span LLM answer           1.3s
```

和本仓库的对应关系：

| 若已有 `traceId` | 本仓库今天用什么代替 |
|------------------|----------------------|
| 串起一次用户请求 | **`taskId`**（单进程内够用） |
| 看 Agent 决策 | 仍看 **`plannerTrace`**，不塞进 span 名里硬叫 trace |
| 看贵不贵 | 仍看 **`metrics`** |

Cursor Usage 截图那种「按模型汇总 token / 美元」是**平台账单视图**；本仓库的 `metrics` 是**单任务学习观测**，理念相近、产品形态不同。

### 易混点速查

| 说法 | 对不对 |
|------|--------|
| metrics = 计费追踪 | ✅ 大体对；精确说是「任务级用量 + **估算**成本」，不是供应商对账单 |
| plannerTrace = 规划追踪 | ✅ |
| traceId = 所有服务请求的 id 追踪 | ✅ 方向对；是**跨服务调用链**关联 id，本仓库还没接 |
| plannerTrace 就是 traceId | ❌ |
| metrics 会把旧数据拿出来再算一遍 | ❌ 只在任务结束当场算一次 |

---

## 和已有概念的完整对照

| 概念 | 回答的问题 | 存哪 / 状态 |
|------|------------|-------------|
| `taskId` | 这是哪一次业务任务 | `tasks.id` |
| `plannerTrace` | 每轮要不要工具、outcome | `planner_steps` |
| `toolCalls` | 工具实际跑了什么 | `tool_calls` |
| **`metrics`** | 耗时 / token / 估算成本 | **`task_metrics`** |
| `traceId`（未实现） | 跨服务调用链 | 未来 OTel |

本阶段**不引入** OpenTelemetry `traceId`：单进程里 `taskId` 已够关联。

---

## 数据流

```text
TaskRunner.run()
  → new TaskMetricsCollector(taskId)
  → PlannerAgent + HunyuanLlmClient
       plan/answer/summarize 在 finally → onLlmCall({ purpose, usage, durationMs })
  → 成功 / failed / cancelled 落库后
  → 读 tool_calls / planner_steps 的行数（只为 count）
  → collector.finalize({ toolCallCount, plannerStepCount })
  → memory.saveTaskMetrics → task_metrics
  → GET /tasks/:id 返回 metrics
```

---

## 估算成本（野路子）

供应商按「百万 token」报价。本仓库：

```text
cost = promptTokens/1e6 * LLM_PRICE_PROMPT_PER_1M_USD
     + completionTokens/1e6 * LLM_PRICE_COMPLETION_PER_1M_USD
```

假数字（默认 $0.5 / $1.5 每百万）：

| | 数 | 算式 | 小计 |
|--|----|------|------|
| prompt | 1271 | 1271/1e6 × 0.5 | 0.0006355 |
| completion | 46 | 46/1e6 × 1.5 | 0.000069 |
| **合计** | | | **≈ 0.0007045 USD** |

这是学习占位价，不是账单；也不会对历史 `task_metrics` 行用新单价重算。

流式 answer 通过 `stream_options.include_usage=true` 尽量拿到末包 usage。若某次调用没返回 `usage`，该次不计入 token，整任务可能 `estimatedCostUsd=null`。

---

## 自检

- [ ] 能用自己的话区分：metrics（用量/估费）/ plannerTrace（规划决策）/ traceId（跨服务链路，未做）
- [ ] 能举「查时间」一例：同一 `taskId` 下三者（或将来 traceId）各长什么样
- [ ] 跑过 `pnpm run smoke:metrics`，或 `/agent/run` 后 `GET /tasks/:id` 有 `metrics.llmCallCount >= 1`
- [ ] `task:replay` 能打印 metrics
- [ ] 知道单价来自 env，改单价**不会**自动重算历史行
