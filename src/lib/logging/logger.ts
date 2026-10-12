import "server-only";

type LogValue = string | number | boolean | null | undefined;
type LogContext = Record<string, LogValue>;

const blockedKey = /authorization|cookie|document|password|secret|token|key/i;

function sanitize(context: LogContext) {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      blockedKey.test(key)
        ? "[REDACTED]"
        : typeof value === "string"
          ? value.replace(/[\r\n\t]/g, " ").slice(0, 500)
          : value,
    ]),
  );
}

function write(
  level: "info" | "warn" | "error",
  event: string,
  context: LogContext,
) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "scholarflow-ai",
    environment: process.env.NODE_ENV ?? "development",
    level,
    event,
    ...sanitize(context),
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}

export const logger = {
  info: (event: string, context: LogContext = {}) =>
    write("info", event, context),
  warn: (event: string, context: LogContext = {}) =>
    write("warn", event, context),
  error: (event: string, context: LogContext = {}) =>
    write("error", event, context),
};
