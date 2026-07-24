# 任务取消与超时（E.8）

> 进度见 [`docs/current-status.md`](../current-status.md) §E.8。  
> 本文解释 **AbortSignal 为什么出现在 Agent 循环里**，以及 cancelled 与 failed 的差别。

## 要解决什么问题

SSE / 长任务跑起来后：

- 用户关页 → 后端若继续调 LLM，浪费钱且状态脏
- 任务卡住 → 需要「整任务超时」兜底
- 调试时 → 需要主动 `POST .../cancel`

这些都不能靠 Prompt「请停止」，必须是**运行时**能力。

## 核心机制

```text
TaskRunner.run()
  → new AbortController + RunningTaskRegistry.register(taskId)
  → 可选 setTimeout → controller.abort(TIMEOUT_ERROR)
  → 可选外部 signal（SSE close）并入
  → PlannerAgent.plan(..., { signal })
       每步边界 throwIfAborted(signal)
       llm.plan / answerWithTool(..., { signal })  // E.8.5 可中途掐 HTTP
  → 成功 / failed / cancelled 落库
  → finally unregister
```

`POST /tasks/:id/cancel` 只做一件事：`runningTasks.abort(taskId)`。  
真正改 `tasks.status` 的是 TaskRunner 的 catch 分支。

## cancelled vs failed

| | cancelled | failed |
|--|-----------|--------|
| 触发 | 用户取消、SSE 断开、超时 | 工具 BAD_REQUEST、LLM 错误等 |
| errorCode | `CANCELLED` 或 `TIMEOUT_ERROR` | `TOOL_ERROR` / `BAD_REQUEST` / … |
| 产品含义 | 「没跑完，被中止」 | 「跑完了，但业务失败」 |

## 协作式取消 → E.8.5 请求级中断

E.8 初版只在 **步进边界** 检查 abort（plan 前后、tool 前后）。  
正在飞的那一次混元 HTTP 要等返回后才停。

**E.8.5：** `plan` / `answerWithTool` / `summarizeSession` 把 `signal` 传给 OpenAI SDK 第二参数 `{ signal }`；  
cancel/超时可中途掐断当前 LLM 请求。Abort 经 `rethrowIfLlmAborted` 转成 `CANCELLED`，避免被包成 `LLM_ERROR` 误标 `failed`。

## 自检

- [ ] 能说出 cancel API 与 TaskRunner 谁改 DB status
- [ ] 知道为什么 Registry 是进程内 Map
- [ ] 跑过 `pnpm run evals:run -- --id task-timeout-smoke`
- [ ] 跑过 `pnpm run smoke:cancel`（或对 wait 15s 手动 cancel），确认不是对 `time` 抢取消
- [ ] 知道 E.8.5 后 cancel 不必等当前混元 HTTP 跑完

## 手测为什么不能用 time

`time` / 普通问答在 2–5 秒内结束，你从 SSE 抄 `taskId` 再 POST cancel 时任务往往已是 `succeeded`，`cancelled:false`。

正确窗口：让 Planner 调 **`wait`（默认演示 15 秒）**，工具按 100ms 切片检查 `AbortSignal`，cancel 会在等待中途生效。  
也可在 **plan 阶段**（thinking 之后、tool_start 之前）cancel，验证 E.8.5 能打断 LLM HTTP。
