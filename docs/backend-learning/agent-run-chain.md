# Agent 执行全链路：`runner.run` → `PlannerAgent.plan`

> **核心结论：** `runner.run` 是一次任务的**执行入口**（DB 状态机外壳）；`PlannerAgent.plan` 是 **Agent 大脑**（LLM 决策 + 工具循环）。  
> **深读：** [`agent-core-flow.md`](./agent-core-flow.md)（每一层细节 + 架构图）。  
> 配套代码注释：`apps/api/src/runtime/task-runner.ts`、`apps/api/src/agents/planner-agent.ts`。

## 总图

```text
curl POST /agent/run  { "input": "..." }
        │
        ▼
server.ts（run 之前）
  readJsonBody → parseSchema → prepareAgentRun(sessionId, taskId)
        │
        ▼  ★ 执行入口
runner.run({ taskId, sessionId, input })
        │
        ├─ TaskRunner（外壳）
        │    ① createTask(running)
        │    ② updateSession(lastTaskAt)
        │    ③ append(user message)
        │    ④ agent.plan()  ─────────────┐
        │    ⑤ updateTask(succeeded)     │
        │    ⑥ return { summary, toolCalls }
        │                                  │
        └─ PlannerAgent.plan（内核）◄─────┘
             buildSessionContext
             for step in 1..maxSteps:
               llm.plan() → 要工具？
                 ├─ 否 → direct_answer / answerWithTool
                 └─ 是 → tool.execute → answerWithTool
             append(assistant) → return
        │
        ▼
server.ts（run 之后）
  writeJson({ sessionId, taskId, result })
```

## 依赖从哪来

`main()` → `createAgentRuntime(config)` 一次性注入：

| 依赖 | 实现 | 职责 |
|------|------|------|
| `runner` | `TaskRunner` | 任务生命周期 |
| `agent` | `PlannerAgent` | plan 循环 |
| `llm` | `HunyuanLlmClient` | 调混元 API |
| `memory` | `PostgresMemoryStore` | 五张表 |
| `tools` | time / http_fetch / echo / read_file | 工具执行 |

文件：`apps/api/src/app/create-agent-runtime.ts`。

## TaskRunner.run 六步

| 步 | 代码 | 写哪 | 目的 |
|----|------|------|------|
| 1 | `createTask(running)` | `tasks` | 可观测 running |
| 2 | `updateSession(lastTaskAt)` | `sessions` | 列表排序 |
| 3 | `append(user)` | `messages` | 本轮用户话 |
| 4 | `agent.plan()` | 多表 | Agent 核心 |
| 5 | `updateTask(succeeded)` | `tasks` | 写 summary |
| 6 | catch → `updateTask(failed)` | `tasks` | 写 error |

## PlannerAgent.plan 分支（每轮 step）

| outcome | 何时 | 下一步 |
|---------|------|--------|
| `direct_answer` | LLM 说不需要工具 | 用 draftAnswer 或已有工具结果生成回答，**break** |
| `budget_exceeded` | 工具次数已达上限还想调 | 用上次工具结果 `answerWithTool`，**break** |
| `duplicate_skipped` | 同名同参工具重复 | 复用已有结果，**break** |
| `tool_executed` | 工具执行成功 | `answerWithTool` 生成人话，**break** |
| `tool_failed` | 工具抛错 | 记库后 **throw**，TaskRunner 标 failed |
| `fallback_answer` | 循环跑满 maxSteps 仍无回答 | 用最后工具结果强行回答 |

`planner_steps.outcome` 对应调试面板 **plannerTrace**；`tool_calls` 对应 **toolCalls**。

## 两种典型路径

### 不用工具（如「介绍你自己」）

```text
llm.plan → needsTool=false
  → draftAnswer
  → recordPlannerStep(direct_answer)
  → append(assistant)
```

### 要工具（如「现在几点」）

```text
llm.plan → needsTool=true, toolName=time
  → TimeTool.execute()
  → recordToolCall + recordPlannerStep(tool_executed)
  → llm.answerWithTool() 流式/一次性
  → append(assistant)
```

## `/agent/run` vs `/agent/stream`

同一 `runner.run`，差别只在第四个参数：

| 路由 | emitStream | 现象 |
|------|------------|------|
| `POST /agent/run` | 不传 | 跑完一次性 JSON |
| `POST /agent/stream` | 传回调写 SSE | RunTimeline 实时更新 |

DB 落库路径相同；SSE 只负责「进行中」展示。

## 读代码顺序

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `server.ts` L48–54 | prepare → run → 响应 |
| 2 | `http/prepare-agent-run.ts` | sessionId / taskId |
| 3 | `runtime/task-runner.ts` | `run()` 六步 |
| 4 | `agents/planner-agent.ts` | `plan()` 循环与 outcome |
| 5 | `llm/hunyuan-llm-client.ts` | `plan` / `answerWithTool` |
| 6 | `memory/postgres-memory-store.ts` | 表读写 |

## 手测

```bash
# 无工具
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"用一句话介绍你自己"}' | tee /tmp/run.json | jq .

# 有工具
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"现在几点"}' | tee /tmp/run.json | jq .

export TASK_ID=$(jq -r .taskId /tmp/run.json)
curl -s http://localhost:3000/tasks/$TASK_ID | jq '{
  status: .task.status,
  plannerTrace: [.plannerTrace[].outcome],
  tools: [.toolCalls[].toolName]
}'
```

## 相关文档

- [http-request-body.md](./http-request-body.md) — run 之前的 body 解析
- [tool-execution-chain.md](./tool-execution-chain.md) — Tool 选型、execute、落库专链
- [consolidation-week.md](../consolidation-week.md) Day 1–2
