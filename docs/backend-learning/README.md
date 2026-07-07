# 后端学习笔记（可反复阅读）

> 从 E.5 巩固周与日常调试中沉淀的**概念说明**，不是进度状态源。进度仍以 [`docs/current-status.md`](../current-status.md) 为准。

## 核心文档（优先读）

| 文档 | 主题 |
|------|------|
| **[agent-core-flow.md](./agent-core-flow.md)** | **Agent 完整原理手册（唯一深读，含 Day1–5 全部主题）** |
| [agent-run-chain.md](./agent-run-chain.md) | 同上链路一页速查 |

## 索引

| 文档 | 主题 |
|------|------|
| [http-request-body.md](./http-request-body.md) | `req` vs `body`；`readJsonBody` 读流；Zod 校验 |
| [debug-http-server.md](./debug-http-server.md) | Cursor/VS Code 调试 `server.ts`；常见启动失败 |
| [request-validation-errors.md](./request-validation-errors.md) | 400 `BAD_REQUEST` 与 `error.details` 工程化 |

## 建议阅读顺序

1. `debug-http-server.md` — 先能 F5 起服务
2. `http-request-body.md` — POST body 从哪来
3. **`agent-core-flow.md`** — **通读一遍（核心）**
4. `agent-run-chain.md` — 复习背诵
5. `request-validation-errors.md` — 校验错误手测

配套动手：[`docs/consolidation-week.md`](../consolidation-week.md) Day 1–5 + 文末总自检。
