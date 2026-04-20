import "dotenv/config";

import { loadConfig } from "../config/env.js";
import { getDatabaseConfig } from "../db/connection-config.js";
import { createPgPool, verifyPgConnection } from "../db/pg-client.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = getDatabaseConfig(config);
  const pool = createPgPool({
    connectionString: database.url,
  });

  await verifyPgConnection(pool);

  const [tasks, messages, toolCalls] = await Promise.all([
    pool.query("select id, status, summary, created_at from tasks order by created_at desc limit 5"),
    pool.query("select task_id, role, created_at from messages order by created_at desc limit 10"),
    pool.query("select task_id, step, tool_name, status, created_at from tool_calls order by created_at desc limit 10"),
  ]);

  console.log(
    JSON.stringify(
      {
        tasks: tasks.rows,
        messages: messages.rows,
        toolCalls: toolCalls.rows,
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
