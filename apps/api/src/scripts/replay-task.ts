import "dotenv/config";

import { loadConfig } from "../config/env.js";
import { getDatabaseConfig } from "../db/connection-config.js";
import { createPgPool, verifyPgConnection } from "../db/pg-client.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((item) => item !== "--");
  const taskId = args[0];

  if (!taskId) {
    throw new Error("Usage: pnpm run task:replay -- <taskId>");
  }

  const config = loadConfig();
  const database = getDatabaseConfig(config);
  const pool = createPgPool({
    connectionString: database.url,
  });

  await verifyPgConnection(pool);

  const [task, messages, toolCalls, plannerTrace] = await Promise.all([
    pool.query(
      `
        select id, input, status, summary, error_code, error_message, created_at, updated_at, finished_at
        from tasks
        where id = $1
      `,
      [taskId],
    ),
    pool.query(
      `
        select role, content, created_at
        from messages
        where task_id = $1
        order by created_at asc, id asc
      `,
      [taskId],
    ),
    pool.query(
      `
        select step, tool_name, tool_input, tool_output, status, error_code, error_message, created_at, finished_at
        from tool_calls
        where task_id = $1
        order by step asc, id asc
      `,
      [taskId],
    ),
    // planner_steps：与 HTTP GET /tasks/:taskId 的 plannerTrace 字段同源。
    pool.query(
      `
        select step, needs_tool, tool_name, tool_input, outcome, error_code, error_message, duration_ms, created_at, finished_at
        from planner_steps
        where task_id = $1
        order by step asc, id asc
      `,
      [taskId],
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        task: task.rows[0] ?? null,
        messages: messages.rows,
        toolCalls: toolCalls.rows,
        plannerTrace: plannerTrace.rows,
      },
      null,
      2,
    ),
  );

  await pool.end();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
