import "dotenv/config";

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createAgentRuntime } from "./app/create-agent-runtime.js";
import { loadConfig } from "./config/env.js";
import { AppError, classifyError } from "./shared/app-error.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { runner, logger } = createAgentRuntime(config);

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
        return;
      }

      if (req.method === "POST" && req.url === "/agent/run") {
        const body = await readJsonBody(req);
        const input = typeof body.input === "string" ? body.input.trim() : "";

        if (!input) {
          throw new AppError("BAD_REQUEST", "Request body must contain a non-empty input string.");
        }

        const taskId = typeof body.taskId === "string" && body.taskId.length > 0 ? body.taskId : randomUUID();
        const result = await runner.run({ taskId, input });

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ taskId, result }, null, 2));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (error: unknown) {
      const appError = classifyError(error);

      logger.error("HTTP request failed", {
        code: appError.code,
        message: appError.message,
        details: appError.details,
      });

      res.writeHead(statusForError(appError.code), { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            code: appError.code,
            message: appError.message,
          },
        }),
      );
    }
  });

  server.listen(config.port, () => {
    logger.info("HTTP server started", {
      port: config.port,
      healthUrl: `http://localhost:${config.port}/health`,
      runUrl: `http://localhost:${config.port}/agent/run`,
    });
  });
}

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  if (raw.length === 0) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be valid JSON.");
  }
}

function statusForError(code: AppError["code"]): number {
  switch (code) {
    case "BAD_REQUEST":
      return 400;
    default:
      return 500;
  }
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
