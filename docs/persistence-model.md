# Persistence Model Design

第一阶段第 1 步的目标是定义最小持久化模型，而不是立刻接数据库。

当前 Agent 运行链路里，最需要长期保存的是三类数据：

- `task`：一次任务运行的主记录
- `message`：任务过程中的消息轨迹
- `tool_call`：工具调用的结构化记录

## 1. 为什么先设计这 3 张表

这是最小闭环：

- `task` 解决“这次任务是什么、状态如何”
- `message` 解决“任务过程里发生了什么”
- `tool_call` 解决“调用了什么工具、输入输出是什么”

这样设计后，后续你可以支持：

- 会话回放
- 失败排查
- 评测对比
- 工具调用统计
- 重试与恢复

## 2. 数据关系

```text
task 1 --- n message
task 1 --- n tool_call
```

当前阶段不额外引入 `session` 表，先把任务级持久化跑通。
后面如果进入多轮用户会话，再补 `session`。

## 3. 表结构设计

### `tasks`

建议字段：

- `id`：任务 id，字符串主键
- `input`：用户原始输入
- `status`：`pending | running | succeeded | failed`
- `summary`：最终回答摘要
- `error_code`：失败时的错误码
- `error_message`：失败时的错误信息
- `created_at`
- `updated_at`
- `finished_at`

职责：

- 记录一次任务的生命周期
- 支撑任务列表、任务详情、失败重试

### `messages`

建议字段：

- `id`：消息 id
- `task_id`：所属任务 id
- `role`：`system | user | assistant | tool`
- `content`：消息正文
- `created_at`

职责：

- 记录完整执行轨迹
- 支撑回放和上下文恢复

### `tool_calls`

建议字段：

- `id`：工具调用 id
- `task_id`：所属任务 id
- `step`：第几步工具调用
- `tool_name`
- `tool_input`
- `tool_output`
- `status`：`succeeded | failed | skipped`
- `error_code`
- `error_message`
- `created_at`
- `finished_at`

职责：

- 记录结构化工具执行
- 支撑工具效果分析和失败排查

## 4. PostgreSQL DDL 草案

```sql
create table tasks (
  id text primary key,
  input text not null,
  status text not null,
  summary text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create table messages (
  id bigserial primary key,
  task_id text not null references tasks(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_messages_task_id_created_at
  on messages(task_id, created_at);

create table tool_calls (
  id bigserial primary key,
  task_id text not null references tasks(id) on delete cascade,
  step integer not null,
  tool_name text not null,
  tool_input text not null,
  tool_output text,
  status text not null,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index idx_tool_calls_task_id_step
  on tool_calls(task_id, step);
```

## 5. 领域建模原则

这一步故意把 `message` 和 `tool_call` 分开，而不是全塞进 `messages`，原因是：

- `message` 更适合做上下文恢复和时间线回放
- `tool_call` 更适合做结构化查询和统计分析

也就是说：

- `messages` 面向“语义轨迹”
- `tool_calls` 面向“工程治理”

## 6. 当前代码如何映射到新模型

现有代码里已经有这些信息来源：

- `TaskRunner` 持有任务入口与结束状态
- `MemoryStore.append()` 已经在写 `user / tool / assistant`
- `PlannerAgent` 已经有 `toolName / input / output / step`

下一步接 PostgreSQL 时，最少需要补 3 类能力：

1. `createTask`
2. `updateTaskStatus`
3. `recordToolCall`

## 7. 这一阶段的完成标准

完成本步骤后，你应该做到：

- 能解释为什么不是只存 `messages`
- 能说清 `task / message / tool_call` 各自职责
- 有一份稳定的数据模型，后续实现不会反复推翻

下一步才进入：

- 用 Docker 启动 PostgreSQL
- 写迁移脚本
- 新增 `PostgresMemoryStore`
