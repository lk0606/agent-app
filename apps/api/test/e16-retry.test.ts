import assert from "node:assert/strict";
import test from "node:test";

import { isRetryableLlmError, readRetryAfterMs } from "../src/llm/hunyuan-llm-client.js";
import { AppError } from "../src/shared/app-error.js";
import { withRetry } from "../src/shared/retry.js";
import { HttpFetchTool } from "../src/tools/http-fetch-tool.js";
import { executeToolWithRetry } from "../src/tools/tool-retry.js";
import type { Tool } from "../src/tools/tool.js";

test("withRetry applies exponential full-jitter delays before succeeding", async () => {
  let attempts = 0;
  const delays: number[] = [];

  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error("temporary network failure");
    }
    return "ok";
  }, {
    maxRetries: 2,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    shouldRetry: () => true,
    random: () => 0.5,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [50, 100]);
});

test("LLM policy retries transient status/network failures only", () => {
  assert.equal(isRetryableLlmError(Object.assign(new Error("limited"), { status: 429 })), true);
  assert.equal(isRetryableLlmError(Object.assign(new Error("unavailable"), { status: 503 })), true);
  assert.equal(isRetryableLlmError(Object.assign(new Error("bad input"), { status: 400 })), false);
  assert.equal(isRetryableLlmError(Object.assign(new Error("reset"), { code: "ECONNRESET" })), true);
});

test("Retry-After supports seconds and HTTP dates", () => {
  const secondsError = Object.assign(new Error("limited"), { headers: { "retry-after": "2" } });
  assert.equal(readRetryAfterMs(secondsError), 2000);

  const future = new Date(Date.now() + 5000).toUTCString();
  const dateError = Object.assign(new Error("limited"), { headers: new Headers({ "retry-after": future }) });
  const parsed = readRetryAfterMs(dateError);
  assert.ok(parsed !== null && parsed >= 3500 && parsed <= 5000);
});

test("http_fetch GET is explicitly eligible for transient Tool retries", () => {
  const tool = new HttpFetchTool({
    timeoutMs: 1000,
    maxChars: 100,
    maxResponseBytes: 100,
    allowedContentTypes: ["text/plain"],
    allowHosts: [],
    denyHosts: [],
  });

  assert.equal(tool.idempotent, true);
});

test("idempotent tool retries NETWORK_ERROR without creating extra business calls", async () => {
  let attempts = 0;
  const tool: Tool = {
    name: "read_file",
    description: "test",
    idempotent: true,
    async execute() {
      attempts += 1;
      if (attempts < 3) {
        throw new AppError("NETWORK_ERROR", "temporary");
      }
      return "content";
    },
  };

  const result = await executeToolWithRetry(tool, { input: "notes.txt" }, {
    maxRetries: 2,
    baseDelayMs: 0,
    maxDelayMs: 0,
  });

  assert.equal(result, "content");
  assert.equal(attempts, 3);
});

test("non-idempotent tool and permanent errors execute once", async () => {
  let writeAttempts = 0;
  const writeTool: Tool = {
    name: "write_file",
    description: "test",
    idempotent: false,
    async execute() {
      writeAttempts += 1;
      throw new AppError("NETWORK_ERROR", "temporary");
    },
  };

  await assert.rejects(
    executeToolWithRetry(writeTool, { input: "out.txt" }, {
      maxRetries: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
    }),
    (error: unknown) => error instanceof AppError && error.code === "NETWORK_ERROR",
  );
  assert.equal(writeAttempts, 1);

  let badRequestAttempts = 0;
  const readTool: Tool = {
    name: "read_file",
    description: "test",
    idempotent: true,
    async execute() {
      badRequestAttempts += 1;
      throw new AppError("BAD_REQUEST", "invalid path");
    },
  };

  await assert.rejects(
    executeToolWithRetry(readTool, { input: "../secret" }, {
      maxRetries: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
    }),
    (error: unknown) => error instanceof AppError && error.code === "BAD_REQUEST",
  );
  assert.equal(badRequestAttempts, 1);
});

test("abort interrupts retry backoff", async () => {
  const controller = new AbortController();
  let attempts = 0;

  const pending = withRetry(async () => {
    attempts += 1;
    throw new Error("temporary");
  }, {
    maxRetries: 3,
    baseDelayMs: 10_000,
    maxDelayMs: 10_000,
    signal: controller.signal,
    shouldRetry: () => true,
    random: () => 1,
  });

  setTimeout(() => controller.abort(new AppError("CANCELLED", "stopped")), 10);
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof AppError && error.code === "CANCELLED",
  );
  assert.equal(attempts, 1);
});
