# Session Context Strategy

这是“会话系统与用户上下文”阶段的下一步：让 session 历史不仅能被模型使用，还能被稳定地控制。

当前项目采用的是“持久化摘要 + 窗口”的上下文注入：

- 较早历史先总结成一段 session summary，并写回 `sessions`
- 最近 N 条消息保留为 recent window
- recent window 再按总字符预算裁剪
- 只把 `user`、`assistant`、`tool` 三类消息喂给模型
- `system` 消息继续保留在存储层，不直接进入会话历史

## 为什么先做摘要加窗口

原因有两个：

- 长会话不会把全部历史直接塞给模型
- 模型仍能看到最近几轮的原始细节，而不是只看压缩过的信息

这一步的目标依然不是“最聪明”，而是“先可控、再扩展”。

## 当前使用的两个参数

### `SESSION_HISTORY_MESSAGE_LIMIT`

控制 recent window 最多保留多少条最近历史消息。

默认值：

```bash
SESSION_HISTORY_MESSAGE_LIMIT=8
```

适合当前阶段的原因：

- 能覆盖最近几轮对话
- 不会让短会话也带上太多无关历史

### `SESSION_HISTORY_CHAR_BUDGET`

控制 recent window 最终传给模型的总字符预算。

默认值：

```bash
SESSION_HISTORY_CHAR_BUDGET=4000
```

当前实现策略：

- 从最近消息开始向前回收
- 超出预算时，只截取最后一段内容
- 优先保留“最近、最相关”的上下文
- 更早历史不丢弃，而是先交给模型压成 summary

## 当前实现的优点

- 配置简单，容易调参
- 对长短会话都更稳
- 能避免 session 一长就无限膨胀
- 给后续“持久化 session summary”方案留好了位置

## 当前实现的限制

- 摘要目前是运行时临时生成的，还没有持久化
- 只按“最近”裁剪 recent window，不按语义相关性裁剪
- 超长消息会被直接截断，可能切断句子

这些限制在当前学习阶段是可以接受的，因为我们现在主要在建立工程骨架和治理意识。

## 推荐调参方式

如果你在本地做实验，可以按这个顺序调：

1. 先调 `SESSION_HISTORY_MESSAGE_LIMIT`
2. 再调 `SESSION_HISTORY_CHAR_BUDGET`
3. 观察：
   - 第二轮回答是否还能记住第一轮信息
   - 工具型对话是否会被旧内容干扰
   - 长网页总结后，后续追问是否还能保持稳定

## 当前执行流程

一次带 `sessionId` 的请求，当前会这样处理：

1. 取出当前 session 的全部历史消息
2. 过滤掉当前 task 自己的消息，以及 `system` 消息
3. 切成两部分：
   - older messages
   - recent window
4. 如果 older messages 不为空：
   - 优先复用 `sessions.summary`
   - 如果有新消息进入 older messages，只增量更新 summary
5. 最终模型输入：
   - `session summary`
   - `recent window`
   - 当前用户输入

## 数据库字段

`sessions` 表里新增了三列：

- `summary`：较早历史的压缩摘要
- `summary_message_count`：当前 summary 已经覆盖的历史消息数量
- `summary_updated_at`：summary 最近更新时间

已有数据库需要执行：

```bash
pnpm run db:migrate
```

新建数据库会在 Docker 初始化时自动执行 `apps/api/infra/postgres/init/003_session_summary.sql`。

## 下一步该怎么演进

这个阶段完成后，下一步推荐做“会话详情 API”：

- 查询 session 列表
- 查询单个 session 的消息时间线
- 查询 session summary
- 支持归档 session

这样前端就能真正展示和管理多轮会话。
