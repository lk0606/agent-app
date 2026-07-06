/** 从 AppConfig 抽出 DATABASE_URL，便于脚本与 runtime 共用 */
import type { AppConfig } from "../config/env.js";

export interface DatabaseConfig {
  url: string;
}

export function getDatabaseConfig(config: AppConfig): DatabaseConfig {
  return {
    url: config.databaseUrl,
  };
}
