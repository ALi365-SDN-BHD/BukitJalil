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
    log(level, event, fields = {}) {
      const line = `${JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })}\n`;
      if (file) fs.appendFileSync(file, line, { mode: 0o600 });
      if (level !== "debug") process.stderr.write(line);
    },
  };
}

export const silentLogger: Logger = { log() {} };
