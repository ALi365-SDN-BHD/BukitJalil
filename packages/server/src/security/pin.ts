import crypto from "node:crypto";
import fs from "node:fs";
import type { SecurityStatus } from "@bukitjalil/shared";
import type { Logger } from "../log.ts";
import { SiteError } from "../sites/location.ts";
import { type Db, openDatabase, rekeyDatabase, WrongPinError } from "../store/db.ts";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
/** Where the idle lock's minutes are kept: a settings row that is not one of the app's settings. */
const IDLE_KEY = "security.idleMinutes";
const PLAIN_SQLITE = Buffer.from("SQLite format 3\0", "latin1");

export interface SecurityOptions {
  /** app.db; null for `pnpm dev` and tests, where the database is plain and never locked. */
  file: string | null;
  logger: Logger;
  /** Called once, with the database the first correct PIN opened: the server starts its services then. */
  onOpen: (db: Db) => void;
  /** Called when the app locks: the server ends its event streams then. */
  onLock?: () => void;
  /** Forgotten PIN: the desktop app restarts the server with --reset, which deletes the data (plan 6.9). */
  onReset?: () => void;
  now?: () => number;
}

/** The PIN, kept only as a salted scrypt hash, to check it again while the database stays open. */
interface Verifier {
  salt: Buffer;
  hash: Buffer;
}

/**
 * The app lock (plan 6.9), after SmartEMR's SecurityService. The PIN is the passphrase of the SQLCipher
 * database: it stays closed until the PIN is set up or entered, and a wrong PIN is "not a database". Locking
 * keeps the database open and work running; it only gates the API, so unlocking again checks the PIN against
 * an in-memory hash. Wrong PINs are counted in memory: five in a row block PIN entry for five minutes.
 * Idle locking is off unless the user sets minutes; the UI reports activity with `touch`.
 */
export class SecurityService {
  private db: Db | null = null;
  private locked = true;
  private failures = 0;
  private retryAt = 0;
  private verifier: Verifier | null = null;
  private idleMinutes: number | null = null;
  private lastActive = 0;
  private readonly now: () => number;

  constructor(private readonly opts: SecurityOptions) {
    this.now = opts.now ?? Date.now;
  }

  get mode(): SecurityStatus["mode"] {
    return this.opts.file === null ? "dev" : "pin";
  }

  /** The encrypted database exists. The data directory holds an empty app.db before the first PIN. */
  private pinSet(): boolean {
    if (this.db) return true;
    const file = this.opts.file;
    return file !== null && (fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > 0;
  }

  /** A plain SQLite file left by an earlier test version, which no PIN opens. */
  private legacy(): boolean {
    const file = this.opts.file;
    if (this.db || file === null || !this.pinSet()) return false;
    const header = Buffer.alloc(PLAIN_SQLITE.length);
    const fd = fs.openSync(file, "r");
    try {
      fs.readSync(fd, header, 0, header.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    return header.equals(PLAIN_SQLITE);
  }

  isLocked(): boolean {
    return this.mode === "pin" && (this.locked || this.db === null);
  }

  status(): SecurityStatus {
    if (this.mode === "dev") {
      return { mode: "dev", pinSet: false, locked: false, retryAfterSeconds: 0, legacy: false, idleMinutes: null };
    }
    return {
      mode: "pin",
      pinSet: this.pinSet(),
      locked: this.isLocked(),
      retryAfterSeconds: Math.max(0, Math.ceil((this.retryAt - this.now()) / 1000)),
      legacy: this.legacy(),
      // Read from the database, so only known once it is open.
      idleMinutes: this.isLocked() ? null : this.idleMinutes,
    };
  }

  /** First start: create the encrypted database with this PIN. */
  setup(pin: string): SecurityStatus {
    const file = this.requireFile();
    if (this.pinSet()) throw new SiteError("security.pin_set", 409);
    let db: Db;
    try {
      db = openDatabase(file, undefined, pin);
    } catch (err) {
      // Leave the empty file the data directory starts with, so the next attempt starts over.
      fs.truncateSync(file, 0);
      for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${file}${suffix}`, { force: true });
      throw err;
    }
    this.opened(db, pin);
    this.opts.logger.log("info", "security.setup", {});
    return this.status();
  }

  unlock(pin: string): SecurityStatus {
    const file = this.requireFile();
    if (!this.pinSet()) throw new SiteError("security.pin_not_set", 409);
    if (this.legacy()) throw new SiteError("security.legacy_database", 409);
    this.assertNoRetryWait();
    if (this.db) {
      if (!this.matches(pin)) this.failed();
    } else {
      let db: Db;
      try {
        db = openDatabase(file, undefined, pin);
      } catch (err) {
        if (err instanceof WrongPinError) this.failed();
        throw err;
      }
      this.opened(db, pin);
    }
    this.failures = 0;
    this.locked = false;
    this.lastActive = this.now();
    this.opts.logger.log("info", "security.unlock", {});
    return this.status();
  }

  lock(reason: "user" | "idle" = "user"): SecurityStatus {
    this.requireFile();
    if (this.db && !this.locked) {
      this.locked = true;
      this.opts.logger.log("info", "security.lock", { reason });
      this.opts.onLock?.();
    }
    return this.status();
  }

  /** The user did something in the app (at most once a minute): the idle lock starts counting again. */
  touch(): SecurityStatus {
    this.requireFile();
    if (!this.isLocked()) this.lastActive = this.now();
    return this.status();
  }

  /** Lock when idle locking is on and the app has not been used for that long; run every 30 seconds. */
  checkIdle(): void {
    if (this.mode !== "pin" || this.isLocked() || this.idleMinutes === null) return;
    if (this.now() - this.lastActive >= this.idleMinutes * 60_000) this.lock("idle");
  }

  /** Turn idle locking off (null) or on after 1–30 minutes; kept in the database. */
  setIdleMinutes(minutes: number | null): SecurityStatus {
    this.requireFile();
    const db = this.db;
    if (!db || this.locked) throw new SiteError("app.locked", 423);
    db.prepare(
      "INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json",
    ).run(IDLE_KEY, JSON.stringify(minutes));
    this.idleMinutes = minutes;
    this.lastActive = this.now();
    return this.status();
  }

  /**
   * Forgotten PIN (plan 6.9): allowed while locked, and during the wait after wrong PINs. The desktop app
   * stops this server and starts it again with --reset, which deletes the data before anything opens it.
   */
  reset(): SecurityStatus {
    this.requireFile();
    if (!this.opts.onReset) throw new SiteError("security.dev_mode", 409);
    this.opts.logger.log("warn", "security.reset", {});
    this.opts.onReset();
    return this.status();
  }

  /** The whole database is encrypted again with the new PIN; the current one is checked first. */
  changePin(currentPin: string, nextPin: string): SecurityStatus {
    this.requireFile();
    const db = this.db;
    if (!db || this.locked) throw new SiteError("app.locked", 423);
    this.assertNoRetryWait();
    if (!this.matches(currentPin)) this.failed();
    this.failures = 0;
    rekeyDatabase(db, nextPin);
    this.verifier = hashPin(nextPin);
    this.opts.logger.log("info", "security.pin_changed", {});
    return this.status();
  }

  private requireFile(): string {
    if (this.opts.file === null) throw new SiteError("security.dev_mode", 409);
    return this.opts.file;
  }

  private opened(db: Db, pin: string): void {
    this.db = db;
    this.verifier = hashPin(pin);
    this.locked = false;
    this.lastActive = this.now();
    this.idleMinutes = readIdleMinutes(db);
    this.opts.onOpen(db);
  }

  private matches(pin: string): boolean {
    if (!this.verifier) return false;
    return crypto.timingSafeEqual(scrypt(pin, this.verifier.salt), this.verifier.hash);
  }

  private assertNoRetryWait(): void {
    const wait = Math.ceil((this.retryAt - this.now()) / 1000);
    if (wait > 0) throw new SiteError("security.retry_later", 429, { seconds: String(wait) });
  }

  private failed(): never {
    this.failures += 1;
    this.opts.logger.log("warn", "security.unlock_failed", { attempt: String(this.failures) });
    if (this.failures >= MAX_ATTEMPTS) {
      this.failures = 0;
      this.retryAt = this.now() + LOCKOUT_MS;
      this.opts.logger.log("warn", "security.lockout", {});
      throw new SiteError("security.retry_later", 429, { seconds: String(LOCKOUT_MS / 1000) });
    }
    throw new SiteError("security.wrong_pin", 403);
  }
}

function readIdleMinutes(db: Db): number | null {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = ?").get(IDLE_KEY) as
    | { value_json: string }
    | undefined;
  if (!row) return null;
  try {
    const value: unknown = JSON.parse(row.value_json);
    return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 30 ? (value as number) : null;
  } catch {
    return null;
  }
}

function scrypt(pin: string, salt: Buffer): Buffer {
  return crypto.scryptSync(pin, salt, 32);
}

function hashPin(pin: string): Verifier {
  const salt = crypto.randomBytes(16);
  return { salt, hash: scrypt(pin, salt) };
}
