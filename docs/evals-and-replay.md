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

- `evals/cases/basic-agent-cases.json`

运行方式：

```bash
pnpm run evals:run
```

输出结果会写到：

- `evals/reports/`

当前第一版支持的检查维度：

- 是否调用了预期工具
- 是否误调用了禁用工具
- 最终回答里是否包含关键字
- 工具调用次数是否超限

## 2. Replay

回放命令：

```bash
pnpm run task:replay -- demo-task
```

它会从 PostgreSQL 中拉出：

- task 主记录
- message 时间线
- tool_call 明细

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
