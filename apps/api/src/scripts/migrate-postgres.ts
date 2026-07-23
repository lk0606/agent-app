import "dotenv/config";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../config/env.js";
import { getDatabaseConfig } from "../db/connection-config.js";
import { createPgPool, verifyPgConnection } from "../db/pg-client.js";

const migrations = [
  "001_init.sql",
  "002_sessions.sql",
  "003_session_summary.sql",
  "004_planner_steps.sql",
  "005_document_chunks.sql",
];
const apiRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

async function main(): Promise<void> {
  const config = loadConfig();
  const database = getDatabaseConfig(config);
  const pool = createPgPool({
    connectionString: database.url,
  });

  await verifyPgConnection(pool);

  for (const migration of migrations) {
    // 当前 SQL 都写成 if not exists，重复执行用于把已有数据库补到最新结构。
    const filePath = resolve(apiRoot, "infra/postgres/init", migration);
    const sql = await readFile(filePath, "utf8");
    await pool.query(sql);
    console.log(`Applied ${migration}`);
  }

  await pool.end();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
