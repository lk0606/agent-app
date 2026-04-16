# PostgreSQL Local Setup

这是第一阶段第 2 步：先把本地 PostgreSQL 启动和初始化表结构搭起来。

## 目录

- `infra/postgres/compose.yaml`
- `infra/postgres/init/001_init.sql`

## 默认配置

- host: `127.0.0.1`
- port: `5432`
- database: `agent_app`
- user: `agent`
- password: `agent`

## 启动数据库

在项目根目录执行：

```bash
docker compose -f infra/postgres/compose.yaml up -d
```

查看状态：

```bash
docker compose -f infra/postgres/compose.yaml ps
```

停止数据库：

```bash
docker compose -f infra/postgres/compose.yaml down
```

如果你想连数据一起清掉：

```bash
docker compose -f infra/postgres/compose.yaml down -v
```

## 连接验证

进入容器：

```bash
docker exec -it agent-app-postgres psql -U agent -d agent_app
```

查看表：

```sql
\dt
select * from tasks limit 5;
select * from messages limit 5;
select * from tool_calls limit 5;
```

## 这一步的目标

这一阶段还没有把应用代码真正连到 PostgreSQL。
当前目标只是：

- 本地可稳定启动 PostgreSQL
- 初始化 `tasks / messages / tool_calls`
- 为下一步实现 `PostgresMemoryStore` 做准备

## 下一步

下一步进入第一阶段第 3 步：

- 安装 PostgreSQL 客户端库
- 新增数据库配置
- 实现 `PostgresMemoryStore`
- 让 `TaskRunner` 和 `PlannerAgent` 开始写入任务、消息、工具调用
