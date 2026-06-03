export interface Logger {
  info(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(scope: string): Logger {
  const emit = (level: "info" | "error", message: string, meta?: unknown, bindings?: Record<string, unknown>) => {
    const payload = {
      level,
      scope,
      message,
      meta,
      ...bindings,
      time: new Date().toISOString(),
    };

    const line = JSON.stringify(payload, null, 2);

    if (level === "error") {
      console.error(line);
      return;
    }

    console.log(line);
  };

  return {
    info(message, meta) {
      emit("info", message, meta);
    },
    error(message, meta) {
      emit("error", message, meta);
    },
    child(bindings) {
      return {
        info(message, meta) {
          emit("info", message, meta, bindings);
        },
        error(message, meta) {
          emit("error", message, meta, bindings);
        },
        child(nextBindings) {
          return createLogger(scope).child({ ...bindings, ...nextBindings });
        },
      };
    },
  };
}
