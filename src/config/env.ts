export interface AppConfig {
  appName: string;
  nodeEnv: string;
}

export function loadConfig(): AppConfig {
  return {
    appName: process.env.APP_NAME ?? "agent-app",
    nodeEnv: process.env.NODE_ENV ?? "development",
  };
}
