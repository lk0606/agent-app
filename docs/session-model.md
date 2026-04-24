# Session Model Design

这是“会话系统与用户上下文”阶段的第 1 步：先定义 `session` 数据模型。

当前系统已经有：

- `task`
- `message`
- `tool_call`

它们能解决“一次任务执行”的持久化问题，但还不能解决“同一个用户连续多轮交互”的问题。

所以现在要补的是：

- `session`

## 1. 为什么要引入 session

没有 `session` 时，系统默认每次请求都是一条孤立任务。

有了 `session` 后，系统才能回答这些问题：

- 这个任务属于哪一次用户会话
- 同一个用户之前说过什么
- 当前任务应不应该继承历史上下文
- 多个任务之间如何组织成连续对话

## 2. 数据关系

建议关系如下：

```text
session 1 --- n task
task 1 --- n message
task 1 --- n tool_call
```

也就是说：

- `session` 是对话级概念
- `task` 是一次执行级概念

一个 session 可以包含多次 task。

## 3. 为什么不把 task 直接当 session

因为两者职责不同：

- `task` 面向一次运行
- `session` 面向连续交互

如果把两者混在一起，后面会很难支持：

- 多轮会话
- 用户上下文继承
- 会话级回放
- 会话归档与分页查询

## 4. session 表结构设计

建议字段：

- `id`：session id
- `title`：会话标题，可为空
- `user_id`：用户 id，可为空，当前阶段先留扩展点
- `status`：`active | archived`
- `created_at`
- `updated_at`
- `last_task_at`

职责：

- 作为多次 task 的父级容器
- 支撑会话列表、会话详情、会话归档

## 5. task 表需要补什么

为了让 task 归属于 session，`tasks` 表建议新增：

- `session_id`：可空外键，引用 `sessions(id)`

这样可以兼容两种模式：

- 无 session 的单次任务
- 属于某个 session 的连续任务

## 6. TypeScript 领域模型建议

建议新增：

- `SessionStatus`
- `SessionRecord`
- `CreateSessionInput`
- `UpdateSessionInput`

并在 `CreateTaskInput` 里增加可选字段：

- `sessionId?: string | null`

## 7. PostgreSQL DDL 草案

```sql
create table sessions (
  id text primary key,
  title text,
  user_id text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_task_at timestamptz
);

alter table tasks
  add column if not exists session_id text references sessions(id) on delete set null;

create index if not exists idx_tasks_session_id_created_at
  on tasks(session_id, created_at);
```

## 8. 当前阶段的设计原则

这里先不做“自动拼接历史消息给模型”，原因是那属于下一步的运行时设计。

这一阶段只做三件事：

- 定义 `session` 的数据结构
- 定义它和 `task` 的关系
- 为后续 API 和 MemoryStore 扩展打基础

## 9. 下一步会做什么

下一步进入“会话系统与用户上下文”的第 2 步时，才会开始：

- 扩展数据库表结构
- 扩展 MemoryStore
- 在 HTTP API 中支持 `sessionId`
- 支持为同一 session 创建多次 task
