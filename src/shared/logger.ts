export interface Logger {
  info(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return {
    info(message, meta) {
      console.log(JSON.stringify({ level: "info", scope, message, meta, time: new Date().toISOString() }));
    },
    error(message, meta) {
      console.error(JSON.stringify({ level: "error", scope, message, meta, time: new Date().toISOString() }));
    },
  };
}
