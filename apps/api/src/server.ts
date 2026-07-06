/**
 * HTTP 服务入口（`pnpm run dev:server` 启动此文件）。
 *
 * 请求大致分四类：
 * 1. Agent 执行：POST /agent/run（一次性 JSON）、POST /agent/stream（SSE 推送进度）
 * 2. Session 查询：GET /sessions、GET /sessions/:id、GET .../messages、PATCH .../archive
 * 3. Task 观测：GET /tasks/:id（messages + toolCalls + plannerTrace）
 * 4. 健康检查：GET /health
 *
 * 编排链：本文件 → prepareAgentRun → TaskRunner → PlannerAgent → LlmClient / Tools → MemoryStore(Postgres)
 */
import "dotenv/config";

import { ListSessionsQuerySchema, RunAgentRequestSchema } from "@agent-app/api-contract";
import type { AgentStreamEvent } from "@agent-app/api-contract";
import { createServer } from "node:http";

import { createAgentRuntime } from "./app/create-agent-runtime.js";
import { loadConfig } from "./config/env.js";
import { getPathSegments, readJsonBody } from "./http/http-request.js";
import { HTTP_STATUS, statusForError, writeJson } from "./http/http-response.js";
import { prepareAgentRun } from "./http/prepare-agent-run.js";
import { endSseResponse, initSseResponse, writeSseEvent } from "./http/sse-response.js";
import { parseSchema } from "./http/validation.js";
import { AppError, classifyError } from "./shared/app-error.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { runner, logger, memory, pool } = createAgentRuntime(config);

  const server = createServer(async (req, res) => {
    try {
      // 浏览器跨域预检；本地前端 dev 需要
      if (req.method === "OPTIONS") {
        writeJson(res, HTTP_STATUS.noContent, null);
        return;
      }

      const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathSegments = getPathSegments(requestUrl);

      if (req.method === "GET" && requestUrl.pathname === "/health") {
        writeJson(res, HTTP_STATUS.ok, { ok: true, time: new Date().toISOString() });
        return;
      }

      // --- Agent 执行（同步 JSON vs SSE 流式，共用 prepareAgentRun 建 session/task）---
      if (req.method === "POST" && requestUrl.pathname === "/agent/run") {
        const body = await readJsonBody(req);
        const agentRequest = parseSchema(RunAgentRequestSchema, body, "Request body");
        const { sessionId, taskId } = await prepareAgentRun(memory, agentRequest);
        const result = await runner.run({ taskId, sessionId, input: agentRequest.input });

        writeJson(res, HTTP_STATUS.ok, { sessionId, taskId, result });
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/agent/stream") {
        const body = await readJsonBody(req);
        const agentRequest = parseSchema(RunAgentRequestSchema, body, "Request body");
        const { sessionId, taskId } = await prepareAgentRun(memory, agentRequest);

        initSseResponse(res);

        const emitStream = (event: AgentStreamEvent) => {
          writeSseEvent(res, event.type, event);
        };

        try {
          const result = await runner.run(
            { taskId, sessionId, input: agentRequest.input },
            { emitStream },
          );

          writeSseEvent(res, "done", {
            type: "done",
            sessionId,
            taskId,
            result,
          });
        } catch (error: unknown) {
          const appError = classifyError(error);

          logger.error("Agent stream failed", {
            taskId,
            code: appError.code,
            message: appError.message,
          });

          writeSseEvent(res, "error", {
            type: "error",
            taskId,
            code: appError.code,
            message: appError.message,
          });
        } finally {
          endSseResponse(res);
        }

        return;
      }

      // --- Session 查询与归档（只读/软删，不触发 Agent）---
      if (req.method === "GET" && requestUrl.pathname === "/sessions") {
        const query = parseSchema(
          ListSessionsQuerySchema,
          Object.fromEntries(requestUrl.searchParams),
          "Query parameters",
        );
        const sessions = await memory.listSessions(query);

        writeJson(res, HTTP_STATUS.ok, { sessions });
        return;
      }

      if (req.method === "GET" && pathSegments[0] === "sessions" && pathSegments.length === 2) {
        const sessionId = pathSegments[1];
        const [session, tasks] = await Promise.all([
          memory.getSession(sessionId),
          memory.listSessionTasks(sessionId),
        ]);

        if (!session) {
          throw new AppError("NOT_FOUND", `Session "${sessionId}" was not found.`);
        }

        writeJson(res, HTTP_STATUS.ok, { session, tasks });
        return;
      }

      if (req.method === "GET" && pathSegments[0] === "sessions" && pathSegments[2] === "messages") {
        const sessionId = pathSegments[1];
        const session = await memory.getSession(sessionId);

        if (!session) {
          throw new AppError("NOT_FOUND", `Session "${sessionId}" was not found.`);
        }

        const messages = await memory.listAllSessionMessages(sessionId);
        writeJson(res, HTTP_STATUS.ok, { sessionId, messages });
        return;
      }

      if (req.method === "PATCH" && pathSegments[0] === "sessions" && pathSegments[2] === "archive") {
        const sessionId = pathSegments[1];
        const session = await memory.getSession(sessionId);

        if (!session) {
          throw new AppError("NOT_FOUND", `Session "${sessionId}" was not found.`);
        }

        await memory.updateSession(sessionId, { status: "archived" });
        const updatedSession = await memory.getSession(sessionId);
        writeJson(res, HTTP_STATUS.ok, { session: updatedSession });
        return;
      }

      // --- Task 详情：一次返回对话、工具执行、规划决策链（plannerTrace）---
      if (req.method === "GET" && pathSegments[0] === "tasks" && pathSegments.length === 2) {
        const taskId = pathSegments[1];
        const [task, messages, toolCalls, plannerTrace] = await Promise.all([
          memory.getTask(taskId),
          memory.list(taskId),
          memory.listTaskToolCalls(taskId),
          // plannerTrace = planner_steps 决策链；toolCalls = 实际执行过的工具（非分布式 traceId）。
          memory.listTaskPlannerSteps(taskId),
        ]);

        if (!task) {
          throw new AppError("NOT_FOUND", `Task "${taskId}" was not found.`);
        }

        writeJson(res, HTTP_STATUS.ok, { task, messages, toolCalls, plannerTrace });
        return;
      }

      writeJson(res, HTTP_STATUS.notFound, { error: "Not found" });
    } catch (error: unknown) {
      const appError = classifyError(error);

      logger.error("HTTP request failed", {
        code: appError.code,
        message: appError.message,
        details: appError.details,
      });

      writeJson(res, statusForError(appError.code), {
        error: {
          code: appError.code,
          message: appError.message,
        },
      });
    }
  });

  server.listen(config.port, () => {
    logger.info("HTTP server started", {
      port: config.port,
      healthUrl: `http://localhost:${config.port}/health`,
      runUrl: `http://localhost:${config.port}/agent/run`,
      streamUrl: `http://localhost:${config.port}/agent/stream`,
    });
  });

  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info("Shutting down HTTP server", { signal });

    server.closeAllConnections?.();

    const finish = () => {
      void pool.end().finally(() => {
        process.exit(0);
      });
    };

    server.close(finish);

    // nodemon 重启时若 close 被 SSE 长连接拖住，强制释放端口
    setTimeout(finish, 500).unref();
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  const appError = classifyError(error);
  console.error(
    JSON.stringify(
      {
        level: "error",
        message: appError.message,
        code: appError.code,
        details: appError.details,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
