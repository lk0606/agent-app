# 轻量 RAG 学习计划（E.7）

> **进度状态**见 [`docs/current-status.md`](../current-status.md) §E.7。  
> 本文是 E.7 的**学习手册**：分阶段目标、原理、读码顺序、验证命令，方便后期回顾。  
> 阶段 1 实现笔记见 [`search-docs-tool-notes.md`](./search-docs-tool-notes.md)。

---

## 目标与边界

| 项 | 说明 |
|----|------|
| **学习目标** | 搞懂「检索 → 注入上下文 → Planner 选工具 → LLM 回答」闭环，不是接 LangChain |
| **实现策略** | **自己串链路**；embedding 等必要环节在阶段 2 再调三方 API |
| **与现有能力关系** | 复用 `READ_FILE_ROOT_DIR` 沙箱；`search_docs` 与 `read_file` / `list_dir` 互补 |
| **不做** | E.7 阶段 1 不上向量库、不上 LangChain/LlamaIndex、不改前端 |

### 三个工具怎么分工

| 工具 | 何时用 | 输入 | 输出 |
|------|--------|------|------|
| `list_dir` | 不知道有哪些文件 | 相对目录路径 | 文件名列表 |
| `read_file` | 已知具体文件路径 | `sample-notes.txt` | 整文件内容 |
| `search_docs` | 不知道在哪个文件，按语义/关键词找片段 | 自然语言查询 | top-k 文本片段 + 来源 |

典型链路：

```text
「文档里提到的日本城市是哪里？」
  → search_docs（跨文件检索）
  → 返回 travel-notes.md 片段含 Osaka
  → LLM 组织回答

「读取 sample-notes.txt 里的城市」
  → read_file（路径明确，不必检索）
```

---

## 分两阶段交付

### 阶段 1：关键词检索 RAG（E.7-A，当前）

**心智模型：** 离线切块 → 内存索引 → 查询打分 → Tool 返回片段。

```text
启动 / 首次查询
  → DocumentIndex.build() 遍历沙箱 .txt/.md
  → 按段落切块（超长再按字符切）
  → 存 { sourcePath, chunkIndex, text }[]

search_docs.execute(query)
  → 分词 query（小写、去标点）
  → 每 chunk 计分：命中词数 + 短语 bonus
  → 取 top-k → 格式化字符串给 LLM
```

| 交付物 | 路径 |
|--------|------|
| 文档索引 | `apps/api/src/rag/document-index.ts` |
| 检索工具 | `apps/api/src/tools/search-docs-tool.ts` |
| 配置 | `env.ts`：`SEARCH_DOCS_MAX_RESULTS`、`SEARCH_DOCS_CHUNK_CHARS` |
| eval +2 | `search-docs-city`、`search-docs-japan-city` |
| fixture +1 | `evals/fixtures/travel-notes.md` |

**阶段 1 故意不做的：**

- embedding / 向量相似度
- pgvector / 持久化索引
- 中文分词器（简单空格+字符切分够用）

### 阶段 2：向量 RAG（E.7-B，未开始）

| 项 | 计划 |
|----|------|
| Embedding | 调 TokenHub / OpenAI 兼容 embedding API |
| 存储 | Postgres 新表或 pgvector 扩展 |
| 索引脚本 | `pnpm run rag:index` 离线建索引 |
| 检索 | 余弦相似度 top-k；可与关键词 hybrid |
| eval | 同义改写查询（「台北」vs「favorite city」） |

阶段 2 开做前：阶段 1 eval 全绿 + 读完本文「阶段 1 自检」。

---

## 自己实现 vs 三方（回顾）

| 环节 | E.7 选择 | 原因 |
|------|----------|------|
| 切块 / 打分 / Tool | 自己写 | 学习数据流；规模小够用 |
| Embedding API | 阶段 2 再用三方 | 不自己训模型 |
| LangChain 等框架 | 不用 | 封装太厚，看不清 Planner 配合 |
| Chroma/Pinecone | 不用 | fixture 规模不值得多一层运维 |

---

## 在 Agent 链路中的位置

```text
POST /agent/run
  → TaskRunner.run()
  → PlannerAgent.plan()
       LLM 见 tools 含 search_docs
       用户问「搜索文档里的…」→ needsTool=true, toolName=search_docs
  → SearchDocsTool.execute()
       DocumentIndex.search(query) → 片段字符串
  → tool_calls 落库 + previousToolCalls 回流
  → answerWithTool() → summary 写入 sessions
```

与 `read_file` 的区别：**检索工具返回的是「相关片段」**，不是整文件；Planner prompt 需写清「跨文件搜索用 search_docs，路径明确用 read_file」。

---

## 阶段 1 读码顺序

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `apps/api/src/rag/document-index.ts` | `build()` 遍历沙箱、`chunkText()`、`search()` 打分 |
| 2 | `apps/api/src/tools/search-docs-tool.ts` | Tool 接口、查询抽取、调用索引 |
| 3 | `apps/api/src/app/create-agent-runtime.ts` | 工具注册；与 read_file 共用 rootDir |
| 4 | `apps/api/src/llm/hunyuan-llm-client.ts` | system prompt 何时选 search_docs |
| 5 | `apps/api/evals/cases/basic-agent-cases.json` | 新 case + 各条 `forbiddenTools` |
| 6 | [`search-docs-tool-notes.md`](./search-docs-tool-notes.md) | 切块策略、打分公式、与 read_file 对比 |

---

## 阶段 1 测试方法

> **完整版**（含预期字段、对比实验、失败排查）见下文 §E.7-A 测试方案。

```bash
docker compose -f apps/api/infra/postgres/compose.yaml up -d
pnpm run db:migrate

# 手测检索（须重启 dev:server 使新工具进 HTTP 进程）
pnpm run dev:server

# 1. favorite city → Taipei（清爽输出见 search-docs-tool-notes.md §用 jq 读清爽输出）
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 search_docs 搜索文档里提到的 favorite city，告诉我城市名"}' \
  | jq '{
      summary: .result.summary,
      tool: .result.toolCalls[0].toolName,
      query: .result.toolCalls[0].input,
      matches: (.result.toolCalls[0].output | split("\n\n")[1:])
    }'

# 2. 跨文件 Japanese city → Osaka（阶段 1 关键词检索须用英文 query，勿用纯中文「日本城市」）
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 search_docs 搜索文档中的 Japanese city，直接回答城市英文名"}' | jq .

# 3. 全量回归（22 条；不需起 dev:server）
pnpm run evals:run
jq '{total, passed, failed}' "$(ls -t apps/api/evals/reports/eval-run-*.json | head -1)"
```

失败排查：`taskId` → `pnpm run task:replay -- <taskId>` → 看 `tool_calls` 与 `plannerTrace`。

---

## 阶段 1 学习要点

1. **RAG 最小闭环**：索引（离线）→ 检索（在线）→ 片段注入 Tool output → LLM 生成；不必先有向量库。
2. **检索是 Tool，不是 Middleware**：与 `read_file` 一样走 Planner 决策，eval 可断言 `expectedTools: ["search_docs"]`。
3. **切块影响召回**：段落切 vs 固定长度切；阶段 1 用段落优先，超长再切。
4. **关键词检索局限**：同义词、语序变化可能漏召；阶段 2 向量检索补位。
5. **沙箱复用**：索引只扫 `READ_FILE_ROOT_DIR` 内白名单扩展名，与 `read_file` 安全边界一致。

---

## 阶段 1 自检清单

完成实现 + 手测后逐项打勾：

- [ ] 能解释 `search_docs` vs `read_file` vs `list_dir` 三者选用场景
- [ ] 能说出 `DocumentIndex.build()` 何时执行、索引存在哪（内存）
- [ ] 能画出「用户 query → 分词 → chunk 打分 → top-k」四步
- [ ] 用手动 curl 触发 `search_docs`，在 `tool_calls` 里看到片段输出
- [ ] `pnpm run evals:run` 22 条全绿
- [ ] 知道改 prompt 去掉 search_docs 规则会导致哪条 eval fail（可对照 eval-break-lab 思路）

**全部打勾 ≈ E.7-A 阶段 1 完成。**

---

## 阶段 2 预习（未开工，仅作回顾锚点）

| 主题 | 要搞懂什么 |
|------|------------|
| Embedding | 文本 → 固定维向量；API 入参/出参 |
| 余弦相似度 | 两向量夹角；比欧氏距离更常用 |
| pgvector | Postgres 扩展；`<=>` 运算符 |
| Hybrid | 关键词 + 向量各取 top-k 再 merge |
| 索引更新 | fixture 变更后如何 reindex |

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [`docs/current-status.md`](../current-status.md) | E.7 进度状态源 |
| [`search-docs-tool-notes.md`](./search-docs-tool-notes.md) | 阶段 1 实现细节 |
| [`list-dir-tool-notes.md`](./list-dir-tool-notes.md) | 沙箱列目录（对照） |
| [`eval-break-lab.md`](./eval-break-lab.md) | 改坏实验模板 |
| [`docs/consolidation-week.md`](../consolidation-week.md) | E.6 结束后选 C 轻量 RAG 的出处 |
