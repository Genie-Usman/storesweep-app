const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

const configuredLevel =
  LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ??
  (process.env.NODE_ENV === "production" ? LEVELS.info : LEVELS.debug);

/**
 * Emit one JSON line per event so any log drain can parse severity,
 * shop, and context without regexes. Values that look like access
 * tokens are never logged: callers only pass structured context.
 */
function emit(level, message, context) {
  if (LEVELS[level] < configuredLevel) return;

  const entry = {
    time: new Date().toISOString(),
    level,
    service: "storesweep",
    message,
    ...context,
  };

  const line = JSON.stringify(entry, (_key, value) =>
    value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value,
  );

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Structured JSON logger. `logger.child({ shop })` binds persistent context. */
export function createLogger(boundContext = {}) {
  return {
    debug: (message, context = {}) => emit("debug", message, { ...boundContext, ...context }),
    info: (message, context = {}) => emit("info", message, { ...boundContext, ...context }),
    warn: (message, context = {}) => emit("warn", message, { ...boundContext, ...context }),
    error: (message, context = {}) => emit("error", message, { ...boundContext, ...context }),
    child: (extraContext) => createLogger({ ...boundContext, ...extraContext }),
  };
}

export const logger = createLogger();
