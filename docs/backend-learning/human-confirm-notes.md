# 人工确认节点（E.10）

> 进度见 [`docs/current-status.md`](../current-status.md) §E.10。  
> 本文解释 **为什么危险工具不能直接 execute**，以及挂起 / 批准 / 拒绝在运行时怎么串。

## 要解决什么问题

Agent 一旦能写文件、调外部副作用，就不能「模型说写就写」：

- 用户要有机会看 `toolName` + `toolInput` 再决定
- 取消（E.8）要能打断「等人」这段等待
- eval 不能因为没人点确认而挂死

## 核心机制

```text
Planner 选中 write_file（requiresConfirmation）
  → SSE awaiting_confirmation
  → tasks.status = awaiting_confirmation
  → ConfirmationRegistry.wait(taskId)   // 进程内未 settle 的 Promise
  → POST /tasks/:id/confirm { decision }
       approve → status=running → tool_start → execute → tool_end
       reject  → tool_calls skipped + HUMAN_REJECTED → 回流 LLM → succeeded
  → cancel / 超时 → AbortSignal → wait reject → cancelled
```

`pendingConfirmation` **不是** DB 列：来自进程内 Registry。  
重启后 DB 可能仍停在 `awaiting_confirmation`，但 `pendingConfirmation=null` → 用 `cancel` 清孤儿。

## wait 怎么挂起（原理）

**不是线程卡住 / `sleep`，而是「故意不完成的 Promise」+ `await`。**

1. `wait()` 里 `new Promise((resolve, reject) => { ... })`，**不立刻**调用 `resolve` / `reject`
2. 把这两个函数存进 `Map[taskId]`（连同 payload）
3. 返回这个仍 pending 的 Promise；Planner `await wait(...)` → 当前 `async` 调用栈退回，**事件循环继续跑**
4. 同一进程因此还能处理 `POST /tasks/:id/confirm`、其它请求

唤醒：

| 来源 | 做什么 | Planner 侧 |
|------|--------|------------|
| `POST .../confirm` | `Map.get(taskId).resolve(approve\|reject)` | `await` 得到 decision，继续 execute 或拒绝回流 |
| cancel / 超时 / SSE 断开 | `AbortSignal` → `reject(CANCELLED)` | `await` 抛错 → TaskRunner 标 `cancelled` |
| `evals` `autoApprove` | 直接 `Promise.resolve("approve")`，不进 Map | 不挂起 |

```text
Planner: await wait()
          │
          ▼
   Promise pending ──存──► Map[taskId] = { resolve, reject, payload }
          │
          │  （事件循环空闲：HTTP / SSE 仍可进）
          │
   confirm ──► entry.resolve("approve")
          │
          ▼
   await 返回 → 再 tool_start / execute
```

对照：

| | 本仓库 wait | 真阻塞（同步死循环） |
|--|-------------|----------------------|
| CPU | 几乎不占 | 占满 |
| 能否收 confirm | 能 | 不能 |
| 「挂住」靠什么 | 未 settle 的 Promise | 占住线程 |
| 进程重启 | Map 丢，DB 可能仍 awaiting（孤儿） | — |

**DB `awaiting_confirmation` 只是观测态**；真正挂住 Planner 的是进程内未 settle 的 Promise。读码：`confirmation-registry.ts` 的 `wait` / `resolve`，以及 `planner-agent.ts` 的 `awaitHumanConfirmation`。

## 与 E.8 cancel 的关系

| | running | awaiting_confirmation |
|--|---------|------------------------|
| cancel | abort controller | abort（兼唤醒 wait）或孤儿直接落库 cancelled |
| 超时 | 同上 | 同上（整任务 timeout 仍生效） |

## CONFIRMATION_AUTO_APPROVE

| 场景 | 取值 |
|------|------|
| `dev:server` 手测 | `false` / 空 |
| `evals:run` | 脚本强制 `1`，避免挂死 |
| 其它直连 TaskRunner 脚本 | 按需设 `1` |

## 自检

- [ ] 能说出「挂起 ≠ 线程阻塞」，而是未 settle 的 Promise + 事件循环
- [ ] 能说出 confirm API 只 `resolve` Promise，真正改终态的是 TaskRunner
- [ ] 知道 DB status 可观测，真正 waiter 在进程内 Map
- [ ] 知道 reject 后任务仍可 `succeeded`，且文件未写入
- [ ] 跑过 `pnpm run smoke:confirm` 与 `-- --decision=reject`
- [ ] 知道进程重启后 confirm 会失败，cancel 可清孤儿
