# Evals And Replay

这一阶段的目标是让 Agent 进入“可验证迭代”状态。

## 为什么要先做这个

现在项目已经能：

- 调模型
- 调工具
- 落 PostgreSQL

但如果没有评测和回放，你后面每次改 prompt、改工具、改模型，都只能靠感觉判断好坏。

## 1. Evals

评测样例放在：

- `apps/api/evals/cases/basic-agent-cases.json`

运行前**必须先启动数据库**：

```bash
docker compose -f apps/api/infra/postgres/compose.yaml up -d
pnpm run db:migrate
pnpm run db:check
```

运行评测：

```bash
pnpm run evals:run
```

输出结果会写到：

- `apps/api/evals/reports/eval-run-*.json`

当前支持的检查维度：

- 是否调用了预期工具（`expectedTools`）
- 是否误调用了禁用工具（`forbiddenTools`）
- 最终回答里是否包含关键字（`expectedKeywords`）
- 最终回答里是否**不得**包含关键字（`forbiddenKeywords`）
- **成功**工具调用次数是否超限（`maxToolCalls`；失败尝试如安全拦截不计入）
- 任务是否按预期失败（`expectedTaskStatus` + `expectedErrorCode`）

### 用例格式

单轮（`input`）：

```json
{
  "id": "time-query",
  "input": "现在几点了？",
  "expectedTools": ["time"],
  "maxToolCalls": 1
}
```

多轮同 session（`steps`，在最后一轮结果上断言）：

```json
{
  "id": "session-memory-city",
  "steps": [
    "请记住：我喜欢东京。只回复收到。",
    "我刚才说我喜欢哪座城市？请直接回答城市名。"
  ],
  "expectedKeywords": ["东京"],
  "maxToolCalls": 0
}
```

每条 case 必须有且仅有 `input` 或 `steps` 之一。

### 当前 18 条用例一览

| id | 测什么 |
|----|--------|
| `time-query` | 命中 `time` 工具 |
| `doc-summary` | 命中 `http_fetch` + 关键词 |
| `direct-answer` | 纯回答、不调工具 |
| `blocked-private-host` | 拦截 `127.0.0.1` → `BAD_REQUEST` |
| `echo-tool-smoke` | 命中 `echo` 工具 |
| `greet-no-tools` | 简单问候、不调工具 |
| `blocked-localhost` | 拦截 `localhost` → `BAD_REQUEST` |
| `session-memory-city` | 多轮 session 记忆（城市） |
| `read-file-fixture` | 命中 `read_file` + 关键词 |
| `blocked-read-env-traversal` | 路径穿越 → `BAD_REQUEST` |
| `blocked-read-absolute-path` | 绝对路径 → `BAD_REQUEST` |
| `session-memory-name` | 3 轮 session 记名 |
| `session-then-time-tool` | 多轮后仍命中 `time` |
| `blocked-http-10-network` | 拦截 `10.x` 私网 |
| `blocked-http-192-network` | 拦截 `192.168.x` 私网 |
| `blocked-read-hidden-dotenv` | 隐藏文件 `.env` |
| `blocked-read-bad-extension` | 非白名单扩展名 `.exe` |
| `read-file-no-secret-leak` | 读 fixture + `forbiddenKeywords` |

改坏实验：[`docs/backend-learning/eval-break-lab.md`](backend-learning/eval-break-lab.md)

## 2. Replay

回放命令：

```bash
pnpm run task:replay -- <taskId>
```

它会从 PostgreSQL 中拉出：

- task 主记录
- message 时间线
- tool_call 明细
- planner_steps 决策链（E.2 起；HTTP / replay 字段名 `plannerTrace`，非分布式 traceId）

这一步很适合排查：

- 为什么模型选了这个工具
- 为什么任务失败
- 同一个任务到底跑了几步

## 3. 当前阶段的价值

到这里为止，你的 Agent 工程已经具备三个关键面：

- 运行闭环
- 持久化闭环
- 验证闭环

这意味着你后面开始做安全治理、会话系统、多步状态机时，不再是盲改。
