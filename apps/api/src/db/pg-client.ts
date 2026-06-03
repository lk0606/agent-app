import { Pool, type PoolConfig } from "pg";

import { AppError } from "../shared/app-error.js";

export interface PgClientOptions {
  connectionString: string;
  max?: number;
}

export function createPgPool(options: PgClientOptions): Pool {
  const config: PoolConfig = {
    connectionString: options.connectionString,
    max: options.max ?? 10,
  };

  return new Pool(config);
}

export async function verifyPgConnection(pool: Pool): Promise<void> {
  try {
    await pool.query("select 1");
  } catch (error: unknown) {
    throw new AppError("CONFIG_ERROR", "Failed to connect to PostgreSQL.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
