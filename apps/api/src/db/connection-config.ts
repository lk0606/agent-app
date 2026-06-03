import type { AppConfig } from "../config/env.js";

export interface DatabaseConfig {
  url: string;
}

export function getDatabaseConfig(config: AppConfig): DatabaseConfig {
  return {
    url: config.databaseUrl,
  };
}
