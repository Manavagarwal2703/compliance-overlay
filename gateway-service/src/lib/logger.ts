/**
 * Structured JSON logging utility for the gateway-service.
 *
 * Every log line emitted by `logger.error()` is a strict JSON object written
 * to stderr so that log-aggregation pipelines (Loki, Datadog, Splunk, etc.)
 * can parse and index individual fields without regex extraction.
 *
 * Fields:
 *   timestamp  – ISO-8601 UTC string
 *   level      – "error" | "warn" | "info"
 *   step       – coarse-grained step name (e.g. "db_upsert", "ai_fetch")
 *   sessionId  – the active session identifier (or "unknown")
 *   error      – stringified error message
 *   [extra]    – any additional key/value pairs passed as the last argument
 */

type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  step: string;
  sessionId?: string;
  error?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, fields: LogFields): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    ...fields,
  };

  // Always write to the appropriate console channel so Next.js / Node.js
  // captures it correctly regardless of stream capture.
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(fields: LogFields): void {
    emit("info", fields);
  },
  warn(fields: LogFields): void {
    emit("warn", fields);
  },
  error(fields: LogFields): void {
    emit("error", fields);
  },
};
