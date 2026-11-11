import fs from "node:fs";
import path from "node:path";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

/** Structured JSON-line logger (plan 13). Never pass message bodies or secrets. */
export interface Logger {
  log(level: Level, event: string, fields?: Fields): void;
}

export function createLogger(logDir: string | null): Logger {
  const file = logDir ? path.join(logDir, "server.log") : null;
  return {
    // Logging never throws: it runs in catch blocks and error handlers, and a full disk (the very error being
    // reported) or a removed logs folder must not turn a handled failure into a crash.
    log(level, event, fields = {}) {
      let line: string;
      try {
        line = `${JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })}\n`;
      } catch {
        line = `${JSON.stringify({ ts: new Date().toISOString(), level, event })}\n`;
      }
      try {
        if (file) fs.appendFileSync(file, line, { mode: 0o600 });
      } catch {
        // Nowhere else to put it.
      }
      try {
        if (level !== "debug") process.stderr.write(line);
      } catch {
        // stderr closed.
      }
    },
  };
}

export const silentLogger: Logger = { log() {} };
