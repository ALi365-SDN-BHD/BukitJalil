import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3-multiple-ciphers";

/** The open app database (better-sqlite3-multiple-ciphers, SQLCipher-capable; plan 6.9). */
export type Db = Database.Database;

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

/** The PIN does not open the encrypted database (plan 6.9). */
export class WrongPinError extends Error {
  constructor() {
    super("wrong PIN");
    this.name = "WrongPinError";
  }
}

/** SQLite string literal for PRAGMA key / rekey, which take no bound parameters. */
const quoteKey = (key: string) => `'${key.replaceAll("'", "''")}'`;

/**
 * Open (or create) app.db and apply pending migrations in order, each in its own transaction. With a PIN the
 * file is a SQLCipher database (plan 6.9): created with that passphrase when empty, otherwise a wrong PIN
 * throws WrongPinError. Without one it is plain SQLite (`pnpm dev`, tests).
 */
export function openDatabase(file: string, migrations = loadMigrations(), pin: string | null = null): Db {
  const db = new Database(file);
  try {
    if (pin !== null) applyKey(db, pin);
    migrate(db, migrations);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

/** SQLCipher 4 defaults (PBKDF2-HMAC-SHA512, 256,000 iterations), as SmartEMR uses them. */
function applyKey(db: Db, pin: string): void {
  db.pragma("cipher='sqlcipher'");
  db.pragma("legacy=4");
  db.pragma(`key=${quoteKey(pin)}`);
  try {
    db.prepare("SELECT count(*) FROM sqlite_master").get();
  } catch (err) {
    // Only "not a database" means the key is wrong; busy or I/O errors are not wrong PINs.
    if ((err as { code?: unknown }).code === "SQLITE_NOTADB") throw new WrongPinError();
    throw err;
  }
}

/**
 * Change the PIN: the whole database is encrypted again with the new passphrase. SQLite3 Multiple Ciphers
 * cannot rekey a database in WAL mode, so the journal goes back to DELETE for the rekey.
 */
export function rekeyDatabase(db: Db, pin: string): void {
  db.pragma("journal_mode = DELETE");
  try {
    db.pragma(`rekey=${quoteKey(pin)}`);
  } finally {
    db.pragma("journal_mode = WAL");
  }
}

function migrate(db: Db, migrations: Migration[]): void {
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
}
