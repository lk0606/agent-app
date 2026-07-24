# 后端学习笔记（可反复阅读）

> 从 E.5 巩固周与日常调试中沉淀的**概念说明**，不是进度状态源。进度仍以 [`docs/current-status.md`](../current-status.md) 为准。

## 核心文档（优先读）

| 文档 | 主题 |
|------|------|
| **[agent-core-flow.md](./agent-core-flow.md)** | **Agent 完整原理手册（唯一深读，含 Day1–5 全部主题）** |
| [agent-run-chain.md](./agent-run-chain.md) | 同上链路一页速查 |
| [tool-execution-chain.md](./tool-execution-chain.md) | **Tool 选型 → execute → 落库 专链（读码顺序 + 调试）** |

## 索引

| 文档 | 主题 |
|------|------|
| [http-request-body.md](./http-request-body.md) | `req` vs `body`；`readJsonBody` 读流；Zod 校验 |
| [debug-http-server.md](./debug-http-server.md) | Cursor/VS Code 调试 `server.ts`；常见启动失败 |
| [request-validation-errors.md](./request-validation-errors.md) | 400 `BAD_REQUEST` 与 `error.details` 工程化 |
| [eval-break-lab.md](./eval-break-lab.md) | E.6-A：故意改坏 + 看 eval 抓回归 |
| [list-dir-tool-notes.md](./list-dir-tool-notes.md) | E.6-B：`readdir` / `Dirent` / `list_dir` 列目录原理 |
| [lightweight-rag-plan.md](./lightweight-rag-plan.md) | **E.7：轻量 RAG 学习计划（阶段 1/2、自检清单）** |
| [search-docs-tool-notes.md](./search-docs-tool-notes.md) | E.7-A：`search_docs` 切块与关键词检索 |
| [embedding-cosine-notes.md](./embedding-cosine-notes.md) | E.7-B：Embedding + 余弦相似度（入参出参 / 分子分母野路子理解） |
| [task-cancel-timeout-notes.md](./task-cancel-timeout-notes.md) | E.8：AbortSignal 取消 / 超时；cancelled vs failed |
| [tool-execution-chain.md](./tool-execution-chain.md) | Tool 运行与调用链路；`plan` vs `execute`；读码与调试 |

## 建议阅读顺序

1. `debug-http-server.md` — 先能 F5 起服务
2. `http-request-body.md` — POST body 从哪来
3. **`agent-core-flow.md`** — **通读一遍（核心）**
4. `agent-run-chain.md` — 复习背诵
5. `tool-execution-chain.md` — Tool 选型/执行/落库专链（加工具前必读）
6. `request-validation-errors.md` — 校验错误手测

配套动手：[`docs/consolidation-week.md`](../consolidation-week.md) Day 1–5 + 文末总自检。
