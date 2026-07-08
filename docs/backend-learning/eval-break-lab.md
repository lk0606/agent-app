# Eval 改坏实验（E.6-A 动手）

> 目标：故意改坏一处行为，确认 `pnpm run evals:run` 能**抓住回归**。  
> 前置：数据库已启动，`evals:run` 当前 **20 条全绿**（见 `basic-agent-cases.json`）。

---

## 怎么跑、怎么看结果（每次改代码后都一样）

**在哪跑：** monorepo **根目录**（有 `package.json` 的那层），不是 `apps/api`。

**不需要**先起 `pnpm run dev:server` —— eval 脚本直接调 `TaskRunner`，不经过 HTTP。

### 1. 一次性准备（每天第一次）

```bash
docker compose -f apps/api/infra/postgres/compose.yaml up -d
pnpm run db:migrate
# 确认 apps/api/.env 里 TokenHub 三件套已配（见 apps/api/.env.example）
```

### 2. 跑全部用例

```bash
pnpm run evals:run
```

- 会顺序跑 **20 条** case，每条都调真实 LLM，全程大约 **1–2 分钟**。
- 过程中终端会刷很多 `"message": "Eval case started/finished"` 日志，**属正常**，等命令结束即可。

### 3. 看 `passed: 20, failed: 0` 的三种方式

**方式 A — 看退出码（最快）**

```bash
pnpm run evals:run
echo $?
```

- 输出 `0` → 全绿（20 passed / 0 failed）
- 输出 `1` → 至少一条失败

**方式 B — 读最新报告文件（推荐，最清晰）**

```bash
pnpm run evals:run
jq '{total, passed, failed}' "$(ls -t apps/api/evals/reports/eval-run-*.json | head -1)"
```

预期全绿时输出：

```json
{
  "total": 20,
  "passed": 20,
  "failed": 0
}
```

**方式 C — 从终端大段 JSON 里搜**

命令跑完后，终端最后会打印一整份 JSON 报告。在输出里搜 `"passed"` / `"failed"` / `"total"`（在 `"results": [...]` 数组**之前**的几行）：

```json
{
  "reportPath": "/.../apps/api/evals/reports/eval-run-1730....json",
  "createdAt": "...",
  "total": 20,
  "passed": 20,
  "failed": 0,
  "results": [ ... ]
}
```

若日志太多不好翻，用方式 B。

### 4. 改坏实验的标准循环

```text
① pnpm run evals:run          → 确认全绿（passed: 20）
② 按下面某一实验改代码
③ pnpm run evals:run          → 确认目标 case fail（failed ≥ 1，exit code 1）
④ git checkout -- <文件> 或手动还原
⑤ pnpm run evals:run          → 再次全绿
```

某条失败时，用报告里的 `taskId` 深挖：

```bash
jq '.results[] | select(.passed == false)' "$(ls -t apps/api/evals/reports/eval-run-*.json | head -1)"
pnpm run task:replay -- <上一步看到的 taskId>
```

---

## 实验前（先确认基线全绿）

```bash
pnpm run evals:run
jq '{total, passed, failed}' "$(ls -t apps/api/evals/reports/eval-run-*.json | head -1)"
# 预期：passed: 20, failed: 0
```

---

## 重要：为什么只注释 prompt 往往「全绿」？

你注释了 `hunyuan-llm-client.ts` 里 time 那句，eval 仍 **20/20** —— **正常**。

原因：`plan()` 的 user 消息里仍有 `Available tools:\n- time: ...`（工具描述），模型不依赖那行 system prompt 也会选 `time`。

**改坏实验要用「确定性」改法**（摘工具、关校验），下面每条都给了**照抄即可**的改法，不依赖模型心情。

**规则：一次只做一个实验 → 跑 eval 看变红 → `git checkout` 还原 → 再做下一个。**

---

## 实验 1：摘掉 `time` 工具（测工具命中）

**文件：** `apps/api/src/app/create-agent-runtime.ts`

**找到（约第 31–33 行）：**

```typescript
  const tools = [
    new TimeTool(),
    new HttpFetchTool({
```

**改成（整行注释 `new TimeTool()`）：**

```typescript
  const tools = [
    // new TimeTool(),
    new HttpFetchTool({
```

**跑：**

```bash
pnpm run evals:run
jq '{total, passed, failed}' "$(ls -t apps/api/evals/reports/eval-run-*.json | head -1)"
```

**预期变红（至少这 2 条）：**

| case id | failures 里大概会出现 |
|---------|----------------------|
| `time-query` | `Expected tool "time" was not used` |
| `session-then-time-tool` | 同上 |

汇总应类似：`"passed": 16, "failed": 2`，且 `echo $?` 为 `1`。

**还原：**

```bash
git checkout -- apps/api/src/app/create-agent-runtime.ts
```

---

## 实验 2：关闭 SSRF 内网拦截（测 http_fetch 安全）

**文件：** `apps/api/src/tools/http-fetch-tool.ts`

**找到文件末尾 `function isPrivateHost`（约第 142 行起），把整个函数体换成：**

```typescript
function isPrivateHost(hostname: string): boolean {
  return false;
}
```

（删掉原来 `if (hostname === "localhost")` 到 `return false` 之间的所有分支。）

**跑：** 同上 `pnpm run evals:run` + `jq`。

**预期变红（这 4 条里至少 1 条，通常 4 条全红）：**

| case id | 原因 |
|---------|------|
| `blocked-private-host` | 任务不再 `failed` + `BAD_REQUEST`（可能连上 127.0.0.1 或变成 `NETWORK_ERROR`） |
| `blocked-localhost` | 同上 |
| `blocked-http-10-network` | 同上 |
| `blocked-http-192-network` | 同上 |

**还原：**

```bash
git checkout -- apps/api/src/tools/http-fetch-tool.ts
```

---

## 实验 3：关掉 read_file 沙箱（测路径/扩展名安全）

只注释 prompt **不够**；`.env` 还在 `deniedBasenames` 里，单删 `startsWith(".")` 也可能全绿。

**文件：** `apps/api/src/tools/read-file-tool.ts`

**找到 `resolveSafePath` 方法开头（约第 72 行），在函数体第一行加上强制返回（下面整段照抄）：**

```typescript
  private resolveSafePath(relativePath: string): string {
    // 【改坏实验】强制所有路径都读 fixture，沙箱失效
    return path.resolve(this.options.rootDir, "sample-notes.txt");

    const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/"));
```

（`return` 后面的旧代码可以留着，不会执行到。）

**跑：** 同上。

**预期变红（这 4 条：本应拦截却读成功）：**

| case id | failures 里大概会出现 |
|---------|----------------------|
| `blocked-read-env-traversal` | `Expected task status "failed" but got "succeeded"` |
| `blocked-read-absolute-path` | 同上 |
| `blocked-read-hidden-dotenv` | 同上 |
| `blocked-read-bad-extension` | 同上 |

`read-file-fixture`、`read-file-no-secret-leak` 仍应 **通过**。

**还原：**

```bash
git checkout -- apps/api/src/tools/read-file-tool.ts
```

---

## 实验 4：关掉会话记忆（测多轮 `steps[]`）

**文件：** `apps/api/src/agents/planner-agent.ts`

**找到 `buildSessionContext`（约第 355 行），在函数体最开头加一行 return：**

```typescript
  private async buildSessionContext(request: AgentRequest, context: AgentContext): Promise<{
    sessionSummary: string | null;
    recentHistory: LlmConversationMessage[];
  }> {
    // 【改坏实验】清空记忆，多轮追问应答不上
    return { sessionSummary: null, recentHistory: [] };

    const sessionId = request.sessionId!;
```

**跑：** 同上。

**预期变红：**

| case id | failures 里大概会出现 |
|---------|----------------------|
| `session-memory-city` | `Expected keyword "东京" was not found` |
| `session-memory-name` | `Expected keyword "李明" was not found` |

**还原：**

```bash
git checkout -- apps/api/src/agents/planner-agent.ts
```

---

## 实验 5：摘掉 `echo` 工具（测单工具冒烟）

**文件：** `apps/api/src/app/create-agent-runtime.ts`

**找到（约第 42 行）：**

```typescript
    new EchoTool(),
    new ReadFileTool({
```

**改成：**

```typescript
    // new EchoTool(),
    new ReadFileTool({
```

**跑：** 同上。

**预期变红：**

| case id | failures |
|---------|----------|
| `echo-tool-smoke` | `Expected tool "echo" was not used` |

**还原：**

```bash
git checkout -- apps/api/src/app/create-agent-runtime.ts
```

---

## 实验 6（可选）：摘掉 `http_fetch`（测外网抓取）

与实验 2 重叠，想多练一次工具注册可试。

**文件：** `apps/api/src/app/create-agent-runtime.ts`

**注释整个 `new HttpFetchTool({ ... }),` 块（约第 33–41 行，含结尾逗号）。**

**预期变红：**

| case id |
|---------|
| `doc-summary` |
| `blocked-private-host` |
| `blocked-localhost` |
| `blocked-http-10-network` |
| `blocked-http-192-network` |

**还原：** `git checkout -- apps/api/src/app/create-agent-runtime.ts`

---

## 实验 7（可选）：摘掉 `list_dir`（测沙箱列目录）

**文件：** `apps/api/src/app/create-agent-runtime.ts`

**注释整个 `new ListDirTool({ ... }),` 块（含结尾逗号）。**

**预期变红：**

| case id |
|---------|
| `list-dir-fixture` |
| `blocked-list-dir-traversal` |

**还原：** `git checkout -- apps/api/src/app/create-agent-runtime.ts`

---

## 全部实验做完后

```bash
git checkout -- apps/api/src/app/create-agent-runtime.ts \
  apps/api/src/tools/http-fetch-tool.ts \
  apps/api/src/tools/read-file-tool.ts \
  apps/api/src/agents/planner-agent.ts

pnpm run evals:run
jq '{total, passed, failed}' "$(ls -t apps/api/evals/reports/eval-run-*.json | head -1)"
# 必须回到 passed: 20, failed: 0
```

---

## 失败时怎么读报告

```bash
pnpm run evals:run

# 列出所有失败条目
jq '.results[] | select(.passed == false) | {id, taskId, failures}' \
  "$(ls -t apps/api/evals/reports/eval-run-*.json | head -1)"

pnpm run task:replay -- <taskId>
```

对照：

| failures 关键词 | 先看 |
|-----------------|------|
| `Expected tool` | `plannerTrace` 里 `needsTool` / `toolName` |
| `Expected keyword` | `messages` 最后一条 assistant |
| `error code` | `tasks.error_code` + `tool_calls.status=failed` |
| `Successful tool call count` | `tool_calls` 成功条数 vs `maxToolCalls` |

---

## 心智模型

```text
改 prompt / 工具 / 上下文
    → evals:run 端到端跑真实 LLM + DB
    → 断言：工具名、关键词、失败码、成功工具次数
    → 有 fail 则 exitCode=1（以后可挂 CI）
```

**注意：** 安全类用例若模型**口头拒绝、不调工具**，任务可能 `succeeded`，eval 会 fail 在 `expectedTools` —— 这是「LLM 行为 vs Tool enforce」边界，巩固周已记录，不必强行改代码。

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [evals-and-replay.md](../evals-and-replay.md) | 用例格式、命令 |
| [agent-core-flow.md](./agent-core-flow.md) | Eval 在全链路中的位置 |
| `apps/api/evals/cases/basic-agent-cases.json` | 20 条用例源 |
