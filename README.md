# Agent App Starter

面向 Node Agent 应用开发的学习型脚手架。

这个仓库同时包含两部分内容：

- 学习规划：帮助你从资深前端工程师平滑切到 Node Agent 应用开发。
- 项目骨架：提供一个可扩展的 TypeScript + Node Agent 分层结构。

## 目录

- `docs/learning-plan.md`：渐进式学习成长计划
- `docs/project-scaffold-plan.md`：项目脚手架搭建计划
- `src/`：Agent 应用骨架代码

## 当前脚手架能力

- `Agent` 抽象与 `PlannerAgent` 示例
- `Tool` 抽象与 `TimeTool`、`HttpFetchTool`、`EchoTool` 示例
- `MemoryStore` 抽象与内存版实现
- `TaskRunner` 运行时
- `HunyuanLlmClient` 实现，通过 OpenAI SDK 接腾讯混元兼容接口

## 快速开始

1. 安装依赖
2. 复制环境变量模板
3. 启动开发模式

```bash
cp .env.example .env
pnpm install
pnpm run dev
```

在 `.env` 中填入：

```bash
HUNYUAN_API_KEY=your_api_key
HUNYUAN_MODEL=hunyuan-turbos-latest
HUNYUAN_BASE_URL=https://api.hunyuan.cloud.tencent.com/v1
```

## 推荐演进顺序

1. 先看 `docs/learning-plan.md`
2. 再看 `docs/project-scaffold-plan.md`
3. 从 `src/index.ts` 开始跑通主流程
4. 观察 `PlannerAgent -> HunyuanLlmClient -> Tool -> HunyuanLlmClient` 的执行链路
5. 逐步增加工具、记忆、任务编排和评测能力
