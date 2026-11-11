import fs from "node:fs";
import path from "node:path";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

/** Structured JSON-line logger (plan 13). Never pass message bodies or secrets. */
export interface Logger {
  log(level: Level, event: string, fields?: Fields): void;
}

const MAX_LOG_BYTES = 5 * 1024 * 1024;

export function createLogger(logDir: string | null): Logger {
  const file = logDir ? path.join(logDir, "server.log") : null;
  const rotated = logDir ? path.join(logDir, "server.log.1") : null;
  let size = 0;
  if (file) {
    try {
      size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
    } catch {
      // A missing or unreadable log is empty; the first append creates it or fails quietly.
    }
  }
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
        if (file) {
          const bytes = Buffer.byteLength(line);
          if (size + bytes > MAX_LOG_BYTES) {
            try {
              if (rotated) {
                fs.rmSync(rotated, { force: true });
                fs.renameSync(file, rotated);
              }
            } catch {
              // A failed rotation must not stop the log line; the file may keep growing until the next try.
            }
            size = 0;
          }
          fs.appendFileSync(file, line, { mode: 0o600 });
          size += bytes;
        }
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
