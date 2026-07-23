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
# 只跑单条（按 case id）
pnpm run evals:run -- --id search-docs-city
# 跨语言那条需 vector|hybrid，且通常先 rag:index
SEARCH_DOCS_MODE=hybrid pnpm run evals:run -- --id search-docs-city-zh
```

### 调试单条向量检索（看余弦断点）

`.vscode/launch.json` → **API: Debug Evals (vector · search-docs-city-zh)**

前置：已跑过 `pnpm run rag:index`（`document_chunks` 非空）。

**不要用 `envFile`：** 会把整份 `.env`（含 API Key）拼进 shell，命令过长被 zsh 截断，进程根本没起来，断点永远不进。配置已改为只靠脚本里的 `import "dotenv/config"` + `env.SEARCH_DOCS_MODE`。

建议断点（按调用顺序）：

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `tools/search-docs-tool.ts` | `embedTexts([query])` — query「台北」变向量 |
| 2 | `rag/document-index.ts` | `searchVector` 里 `cosineSimilarity(...)` |
| 3 | `rag/cosine-similarity.ts` | **`for` 循环或最后的 `return dot / denominator`**（不要断 early-return 那几行） |

keyword 那条不会进 2/3；只有 `SEARCH_DOCS_MODE=vector|hybrid` 才会。

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

### 用例组织策略（何时拆文件）

> **决策日期：2026-07-08** — 当前 **20 条、单文件** 足够；到阶段阈值再按本策略拆分，避免过早分类增加维护成本。

**现在怎么做（&lt;30 条）**

- 继续用 **一个文件**：`evals/cases/basic-agent-cases.json`
- **不**加 `category` / `tags` 字段；分类靠 **`id` 命名约定** + 下方一览表：
  - `blocked-*` — 安全拦截（SSRF、路径穿越、扩展名等）
  - `session-*` — 多轮同 session 记忆
  - `{tool}-*` / `*-fixture` — 工具冒烟与 fixture 读取
- 新增 case 时保持上述前缀，便于 `grep` 和改坏实验对照

**阶段阈值 — 到时再动**

| 规模 / 痛点 | 动作 |
|-------------|------|
| **~30 条**，或单文件难找、改一类要滚很久 | **按主题拆文件**（推荐 2–3 个，不要每工具一文件）：`smoke-tools.json`、`security.json`、`memory.json` |
| **~50+ 条**，或 CI 需要「只跑安全 / 只跑记忆」 | 在 case 上加可选 `tags`，`run-evals.ts` 支持 `--tag` 筛选 |
| 任意阶段 | `pnpm run evals:run` **默认仍跑全量全绿**；局部调试用 `--id <caseId>` 或指定单个 json 路径 |

**拆文件时必做（与 runner 对齐）**

1. 改 `run-evals.ts`：无参数时 **合并** `evals/cases/*.json`（当前只读单个路径，注释写 `*.json` 但尚未实现目录扫描）
2. 保留 `argv[2]` 跑单个文件，例如：`pnpm run evals:run -- evals/cases/security.json`
3. 校验 **全局 `id` 唯一**（合并后不能重名）
4. 更新本文「用例一览」与各 E 节交付记录中的条数

**不建议**

- 为分类而分类：10 条就拆 5 个文件
- JSON 顶层改成 `{ "security": [...] }` 嵌套 — 与现有「数组 + `loadCases`」不兼容，要重写加载逻辑
- 没有「只跑子集」需求前提前上 `tags` — 只是重复注释

### 当前 20 条用例一览

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
| `list-dir-fixture` | 命中 `list_dir` + 关键词 |
| `blocked-list-dir-traversal` | `list_dir` 绝对路径 → `BAD_REQUEST` |

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
