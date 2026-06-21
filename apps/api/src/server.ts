import "dotenv/config";

import { ListSessionsQuerySchema, RunAgentRequestSchema } from "@agent-app/api-contract";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createAgentRuntime } from "./app/create-agent-runtime.js";
import { loadConfig } from "./config/env.js";
import { getPathSegments, readJsonBody } from "./http/http-request.js";
import { HTTP_STATUS, statusForError, writeJson } from "./http/http-response.js";
import { parseSchema } from "./http/validation.js";
import { AppError, classifyError } from "./shared/app-error.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { runner, logger, memory, pool } = createAgentRuntime(config);

  const server = createServer(async (req, res) => {
    try {
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

      if (req.method === "POST" && requestUrl.pathname === "/agent/run") {
        const body = await readJsonBody(req);
        const agentRequest = parseSchema(RunAgentRequestSchema, body, "Request body");
        let sessionId = agentRequest.sessionId ?? null;

        if (!sessionId) {
          sessionId = randomUUID();
          await memory.createSession({
            id: sessionId,
          });
        } else {
          const session = await memory.getSession(sessionId);

          if (!session) {
            await memory.createSession({
              id: sessionId,
            });
          }
        }

        const taskId = agentRequest.taskId ?? randomUUID();
        const result = await runner.run({ taskId, sessionId, input: agentRequest.input });

        writeJson(res, HTTP_STATUS.ok, { sessionId, taskId, result });
        return;
      }

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
    });
  });

  const shutdown = async () => {
    server.close();
    await pool.end();
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
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
