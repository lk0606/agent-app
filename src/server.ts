import "dotenv/config";

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createAgentRuntime } from "./app/create-agent-runtime.js";
import { loadConfig } from "./config/env.js";
import { getPathSegments, parsePositiveInt, readJsonBody } from "./http/http-request.js";
import { HTTP_STATUS, statusForError, writeJson } from "./http/http-response.js";
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
        const input = typeof body.input === "string" ? body.input.trim() : "";

        if (!input) {
          throw new AppError("BAD_REQUEST", "Request body must contain a non-empty input string.");
        }

        let sessionId =
          typeof body.sessionId === "string" && body.sessionId.trim().length > 0 ? body.sessionId.trim() : null;

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

        const taskId = typeof body.taskId === "string" && body.taskId.length > 0 ? body.taskId : randomUUID();
        const result = await runner.run({ taskId, sessionId, input });

        writeJson(res, HTTP_STATUS.ok, { sessionId, taskId, result });
        return;
      }

      if (req.method === "GET" && requestUrl.pathname === "/sessions") {
        const status = parseSessionStatus(requestUrl.searchParams.get("status"));
        const limit = parsePositiveInt(requestUrl.searchParams.get("limit"), {
          fallback: 50,
          max: 100,
          name: "limit",
        });
        const sessions = await memory.listSessions({ status, limit });

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
        const [task, messages, toolCalls] = await Promise.all([
          memory.getTask(taskId),
          memory.list(taskId),
          memory.listTaskToolCalls(taskId),
        ]);

        if (!task) {
          throw new AppError("NOT_FOUND", `Task "${taskId}" was not found.`);
        }

        writeJson(res, HTTP_STATUS.ok, { task, messages, toolCalls });
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

function parseSessionStatus(value: string | null): "active" | "archived" | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "active" || value === "archived") {
    return value;
  }

  throw new AppError("BAD_REQUEST", 'Query parameter "status" must be "active" or "archived".');
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
