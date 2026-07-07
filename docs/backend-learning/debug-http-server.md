# 调试 HTTP Server（Cursor / VS Code）

## 配置在哪

`.vscode/launch.json` → **API: Debug HTTP Server**

- `program`: `apps/api/src/server.ts`
- `runtimeArgs`: `["--import", "tsx"]`
- `cwd`: `apps/api`
- **不**使用 `envFile`：`server.ts` 顶部 `import "dotenv/config"` 会读 `apps/api/.env`
- 日志输出：**调试控制台**（`internalConsole`），不是 curl 那个终端

## 怎样算启动成功

F5 后，在 **调试控制台** 必须看到：

```json
{
  "message": "HTTP server started",
  "meta": { "port": 3000, "healthUrl": "..." }
}
```

然后再：

```bash
curl -s http://localhost:3000/health | jq .
```

## 常见误判

### 1. 把「启动命令回显」当成「服务已起来」

集成终端里可能出现很长一串：

```text
/usr/bin/env APP_NAME=... HUNYUAN_API_KEY=... NODE_OPTIONS=...
```

那只是调试器拼出来的 shell 命令。**没有** `HTTP server started` = 没起来。

历史上 `launch.json` 使用 `envFile` 会把 `.env` 全部内联进命令，命令过长在 zsh 里可能被截断，Node 根本没执行。现已改为依赖 `dotenv/config`。

### 2. `Connection refused`

```text
curl: (7) Failed to connect to localhost port 3000: Connection refused
```

**3000 端口没有进程监听**。先 F5 或 `pnpm run dev:server`，再 curl。

### 3. 断点导致 curl「没反应」

断点打在 `POST /agent/run` handler 内（如 `readJsonBody` 之后）时：

- 调试工具栏显示 **Paused**
- curl 会一直等待，直到你按 **F5 Continue**

`/health` **不会**走进 `/agent/run` 那段 handler。

### 4. 和 `dev:server` 抢端口

不要同时跑：

- `pnpm run dev:server`
- **API: Debug HTTP Server**

二者都占 3000，后起的会 `EADDRINUSE` 或行为异常。

## 断点建议（巩固周 Day 1）

| 目的 | 文件 | 行附近 |
|------|------|--------|
| 确认服务启动 | `server.ts` | `server.listen` |
| 看 body 解析 | `http-request.ts` | `JSON.parse` |
| 看契约校验 | `server.ts` | `parseSchema(...)` |
| 看 session/task 创建 | `prepare-agent-run.ts` | 全文 |
| 看 Agent 循环 | `task-runner.ts` | `run()` |

`server.ts` 里 `console.log(req)` **看不到** `input`，见 [http-request-body.md](./http-request-body.md)。

## tsx 断点绑不上（空心灰点）

`launch.json` 已配置：

```json
"sourceMaps": true,
"resolveSourceMapLocations": ["${workspaceFolder}/**", "!**/node_modules/**"]
```

若仍 unbound：保存文件 → 停掉 debug → 重新 F5。

## 操作清单

1. 停止 debug（红色方块）
2. 运行和调试 → **API: Debug HTTP Server** → F5
3. 调试控制台出现 `HTTP server started`
4. 断点打在目标行（实心红点）
5. 另开终端 `curl`（`/agent/run` 才能进 handler 内断点）
6. 若 Paused → F5 继续
