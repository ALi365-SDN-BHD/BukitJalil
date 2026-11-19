import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const MIGRATION_FILE = /^(\d{3})_[a-z0-9_]+\.sql$/;

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return fs
    .readdirSync(dir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort()
    .map((name) => ({
      version: Number.parseInt(name.slice(0, 3), 10),
      name,
      sql: fs.readFileSync(path.join(dir, name), "utf8"),
    }));
}

/** Open (or create) app.db and apply pending migrations in order, each in its own transaction. */
export function openDatabase(file: string, migrations = loadMigrations()): DatabaseSync {
  const db = new DatabaseSync(file);
  // Foreign keys stay off while migrations run: a table rebuild (013) drops and recreates referenced tables,
  // and with them on, DROP TABLE would run the ON DELETE actions of the rows it removes. PRAGMA foreign_keys
  // has no effect inside a transaction, so it is set here, and each migration checks the keys before commit.
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  try {
    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      db.exec("BEGIN");
      try {
        db.exec(m.sql);
        if (db.prepare("PRAGMA foreign_key_check").all().length > 0) throw new Error("foreign key check failed");
        db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
          m.version,
          new Date().toISOString(),
        );
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw new Error(`migration ${m.name} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    // Also after a failed migration: whoever keeps the handle must not write without the keys enforced.
    db.exec("PRAGMA foreign_keys = ON");
  }
  return db;
}
