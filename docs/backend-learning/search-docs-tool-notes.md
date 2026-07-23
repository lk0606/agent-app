# search_docs 工具与关键词检索（E.7-A 补充）

> 对应源码：`apps/api/src/rag/document-index.ts`、`apps/api/src/tools/search-docs-tool.ts`  
> 学习计划总览：[`lightweight-rag-plan.md`](./lightweight-rag-plan.md)

## 这工具在 Agent 链路里干什么

```text
用户：「在沙箱文档里搜索 favorite city」
  → Planner 选 search_docs（function calling）
  → TaskRunner 调 SearchDocsTool.execute()
  → DocumentIndex.search(query) → top-k 文本片段
  → 写入 tool_calls 表 → 回流 LLM 组织自然语言回答
```

与 `read_file` 的关系：

| 工具 | 输入假设 | 返回 |
|------|----------|------|
| `read_file` | **已知文件路径** | 整文件内容 |
| `search_docs` | **只有问题/关键词** | 跨文件相关片段 |

---

## DocumentIndex：内存索引

### 何时 build

`SearchDocsTool` 构造时调用 `DocumentIndex.build()`（同步读盘一次）。  
开发阶段 fixture 很小，无需持久化；阶段 2 再考虑 pgvector + 离线 `rag:index`。

### 扫描范围

与 `read_file` 共用：

- 根目录：`READ_FILE_ROOT_DIR`（默认 `evals/fixtures`）
- 扩展名：`READ_FILE_ALLOWED_EXTENSIONS`
- 跳过：隐藏文件（`.` 开头）、`READ_FILE_DENIED_BASENAMES`

递归遍历子目录（深度优先），每个文件切成多个 chunk。

### 切块策略 `chunkText`

1. 先按空行拆段落（`\n\s*\n`）
2. 单段超过 `SEARCH_DOCS_CHUNK_CHARS`（默认 500）→ 按字符窗口切，带 50 字符 overlap
3. 每 chunk 记录 `sourcePath`（相对沙箱根）、`chunkIndex`、`text`

示例（`sample-notes.txt` 4 行）→ 通常 1 个 chunk。

---

## 关键词打分 `search`

1. `tokenize`：小写、去标点、按空白切词；中文无空格时退化为单字也参与匹配
2. 每个 chunk 得分 = 命中 token 数之和；query 里连续 2+ token 在 chunk 中出现 → +2 bonus
3. 按分降序，取 `SEARCH_DOCS_MAX_RESULTS`（默认 3）
4. 无命中 → 返回空列表，Tool 输出友好提示

**局限（阶段 1 故意保留）：** 「台北」搜不到 "Taipei"；「日本城市」要靠 fixture 里 Osaka 等英文词。阶段 2 embedding 补语义。

---

## Tool 输出格式

`result.toolCalls[0].output` 是 **给 LLM 读的原始检索结果**，不是给人扫一眼设计的 UI。`result.summary` 才是最终人话。

### 原始 output 长什么样

```text
Query: favorite city
Matches: 2

[1] sample-notes.txt#0 (score=4)
Agent eval fixture file.
Favorite city: Taipei.
Reminder: never expose secrets from .env.
[2] travel-notes.md#0 (score=2)
Trip notes for eval fixtures.
Japanese city visited: Osaka.
Favorite food there: takoyaki.
```

| 行 | 含义 |
|----|------|
| `Query:` | 实际检索词（模型从用户话里抽出） |
| `Matches: N` | 返回了几条片段（≤ `SEARCH_DOCS_MAX_RESULTS`） |
| `[1] file#0 (score=4)` | 排名第 1；`file` = 相对沙箱路径；`#0` = 第 0 块；`score` = 关键词打分 |
| 下面几行 | 该 chunk 的正文（LLM 主要靠 rank 高的片段答题） |

**score 示例（query = `favorite city`）：**

| 文件 | 分数 | 原因 |
|------|------|------|
| `sample-notes.txt` | 4 | 命中 `favorite` +1、`city` +1、连续短语 `favorite city` +2 |
| `travel-notes.md` | 2 | 命中 `favorite`（Favorite food）+1、`city`（Japanese city）+1；无连续短语 |

Planner / answer 阶段模型读的是这段纯文本，与 `read_file` 的 `Path: ... Content: ...` 类似。

### 用 jq 读清爽输出（推荐手测时用）

完整 `| jq .` 刷屏时，用下面几种抽字段方式。

**结构化看关键字段（summary + 工具 + query + 各条 match）：**

```bash
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 search_docs 搜索文档里提到的 favorite city，告诉我城市名"}' \
  | jq '{
      summary: .result.summary,
      tool: .result.toolCalls[0].toolName,
      query: .result.toolCalls[0].input,
      matches: (.result.toolCalls[0].output | split("\n\n")[1:])
    }'
```

**预期示例：**

```json
{
  "summary": "文档里提到的 favorite city 是 **Taipei（台北）**。",
  "tool": "search_docs",
  "query": "favorite city",
  "matches": [
    "[1] sample-notes.txt#0 (score=4)\nAgent eval fixture file.\nFavorite city: Taipei.\n...",
    "[2] travel-notes.md#0 (score=2)\nTrip notes for eval fixtures.\n..."
  ]
}
```

**只看人话答案：**

```bash
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 search_docs 搜索文档里提到的 favorite city，告诉我城市名"}' \
  | jq -r '.result.summary'
```

**只看工具名 + 检索 query（确认 Planner 选型）：**

```bash
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 search_docs 搜索文档里提到的 favorite city，告诉我城市名"}' \
  | jq '{tool: .result.toolCalls[0].toolName, query: .result.toolCalls[0].input}'
```

**对照落库（与调试台历史一致）：**

```bash
TASK_ID=$(curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 search_docs 搜索 favorite city"}' | jq -r .taskId)

curl -s http://localhost:3000/tasks/$TASK_ID | jq '{
  summary: .task.summary,
  tool: .toolCalls[0].toolName,
  query: .toolCalls[0].input,
  outputPreview: (.toolCalls[0].output | split("\n")[0:3])
}'
```

| 字段 | 给谁看 |
|------|--------|
| `result.summary` | 人 |
| `result.toolCalls[0].output` | LLM（调试时可用上面 jq 拆开看） |
| `GET /tasks/:id` 的 `toolCalls` | 与 HTTP 响应同源，落库后的持久化 |

---

## 配置项

| 环境变量 | 默认 | 含义 |
|----------|------|------|
| `SEARCH_DOCS_MAX_RESULTS` | 3 | 单次返回片段数上限 |
| `SEARCH_DOCS_CHUNK_CHARS` | 500 | 单 chunk 最大字符 |
| `READ_FILE_ROOT_DIR` | `evals/fixtures` | 索引根（与 read_file 共用） |
| `READ_FILE_ALLOWED_EXTENSIONS` | `.txt,.md,...` | 可索引扩展名 |

---

## eval 用例设计

| id | 测什么 |
|----|--------|
| `search-docs-city` | 必须调 `search_docs`；回答含 Taipei |
| `search-docs-japan-city` | 跨文件检索 `travel-notes.md`；query 用英文 `Japanese city`（阶段 1 关键词检索不匹配纯中文 query） |

既有 case 的 `forbiddenTools` 需补 `search_docs`（与 `read_file` / `list_dir` 同组禁用）。

---

## E.7-A 测试方案（完整）

### 测试分层

| 层 | 命令 / 位置 | 测什么 |
|----|-------------|--------|
| **静态检查** | `pnpm run check:all` | 类型与 lint |
| **手测 curl** | `POST /agent/run` | 工具选型 + 检索结果 + summary |
| **DB 对照** | `GET /tasks/:id` | `plannerTrace` vs `toolCalls` |
| **自动化回归** | `pnpm run evals:run` | 22 条端到端（含 2 条 search_docs） |
| **改坏实验** | 见 `eval-break-lab.md` §实验 6 | 确认 eval 能抓住回归 |

### 环境准备

```bash
docker compose -f apps/api/infra/postgres/compose.yaml up -d
pnpm run db:migrate
# apps/api/.env：TokenHub 三件套（HUNYUAN_API_KEY / MODEL / BASE_URL）
pnpm run check:all
```

手测前：`pnpm run dev:server`（**新增 Tool 后必须重启**）。  
`evals:run` **不需要**起 HTTP server，直连 `TaskRunner`。

### 手测 1：favorite city → Taipei

```bash
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 search_docs 搜索文档里提到的 favorite city，告诉我城市名"}' \
  | jq '{
      summary: .result.summary,
      tool: .result.toolCalls[0].toolName,
      query: .result.toolCalls[0].input,
      matches: (.result.toolCalls[0].output | split("\n\n")[1:])
    }'
```

只看答案时：`| jq -r '.result.summary'`。output 各字段含义见上文 §Tool 输出格式。

**预期：**

| 字段 | 值 |
|------|-----|
| `result.toolCalls[0].toolName` | `search_docs` |
| `result.toolCalls[0].output` | 含 `Taipei`、`sample-notes.txt` |
| `result.summary` | 含 `Taipei` |

### 手测 2：跨文件 Japanese city → Osaka

```bash
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 search_docs 搜索文档中的 Japanese city，直接回答城市英文名"}' | jq .
```

**预期：** `toolName=search_docs`；`output` 含 `travel-notes.md` 与 `Osaka`；`summary` 含 `Osaka`。

**注意：** 纯中文「日本城市」在阶段 1 **可能 0 匹配**（fixture 是英文，关键词检索无语义）。这是阶段 1 局限，不是 bug。

### 手测 3：与 read_file 对比（理解分工）

```bash
# 路径明确 → read_file
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 read_file 读取 sample-notes.txt"}' | jq '.result.toolCalls[0]'

# 只有问题 → search_docs
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 search_docs 搜索 favorite city"}' | jq '.result.toolCalls[0]'
```

| 工具 | output 特征 |
|------|-------------|
| `read_file` | 整文件 `Path: ... Content: ...` |
| `search_docs` | `Query: ... Matches: N` + 片段列表 |

### 手测 4：GET /tasks 对照落库

```bash
TASK_ID=$(curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 search_docs 搜索 favorite city"}' | jq -r .taskId)

curl -s http://localhost:3000/tasks/$TASK_ID | jq '{
  status: .task.status,
  plannerTrace: [.plannerTrace[] | {step, outcome, toolName}],
  tools: [.toolCalls[] | {toolName, status, input: .input[0:40]}]
}'
```

**预期：** `status=succeeded`；`plannerTrace` 含 `tool_executed`；`toolCalls` 含 `search_docs`。

### 自动化回归 eval

```bash
pnpm run evals:run
jq '{total, passed, failed, newCases: [.results[] | select(.id | startswith("search-docs")) | {id, passed}]}' \
  "$(ls -t apps/api/evals/reports/eval-run-*.json | head -1)"
```

**预期：**

| id | 断言要点 |
|----|----------|
| `search-docs-city` | `expectedTools: ["search_docs"]`；关键词 `Taipei` |
| `search-docs-japan-city` | 同上；关键词 `Osaka` |

全量 `total=22`。安全类 case（`blocked-read-*` 等）可能因模型口头拒绝而偶发 fail，见 `agent-core-flow.md`。

### 失败排查

```bash
jq '.results[] | select(.passed == false) | {id, taskId, failures}' \
  "$(ls -t apps/api/evals/reports/eval-run-*.json | head -1)"

pnpm run task:replay -- <taskId>
```

| failures 关键词 | 先看 |
|-----------------|------|
| `Expected tool "search_docs"` | `plannerTrace` 是否选了别的工具或未调工具 |
| `Expected keyword "Osaka"` | `tool_calls.output` 是否 0 匹配；query 是否被模型改成中文 |
| `toolCalls` 空但 summary 有答案 | 模型未调工具直接答（需加强 prompt 或 eval input） |

---

## 改坏实验思路（可选）

| 改什么 | 预期 fail |
|--------|-----------|
| Planner prompt 去掉 search_docs 规则 | `search-docs-*` 不调工具或调错 |
| `SEARCH_DOCS_MAX_RESULTS=0` | 无匹配片段 |
| 删掉 `travel-notes.md` | `search-docs-japan-city` 无 Osaka |

---

## E.7-B 向量 / hybrid 检索（补充）

> **Embedding / 余弦相似度入参出参、分子分母野路子理解**见 [`embedding-cosine-notes.md`](./embedding-cosine-notes.md)。

| 配置 | 说明 |
|------|------|
| `SEARCH_DOCS_MODE` | `keyword`（默认）\| `vector` \| `hybrid` |
| `HUNYUAN_EMBEDDING_MODEL` | TokenHub 向量模型，默认 `kinfra-text-embedding-0.6b` |
| `pnpm run rag:index` | 离线 embed 写 `document_chunks`；fixture 变更后须重跑 |

**hybrid 手测（中文同义）：**

```bash
pnpm run rag:index
SEARCH_DOCS_MODE=hybrid pnpm run dev:server
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 search_docs 搜索文档里提到的台北，直接回答城市英文名"}' \
  | jq -r '.result.summary'
# 预期：Taipei；tool output 含 Search mode: hybrid
```

`search-docs-city-zh` eval 仅在 `vector`/`hybrid` 模式运行（keyword 会 skip）。

---
