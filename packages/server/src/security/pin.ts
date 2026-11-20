import crypto from "node:crypto";
import fs from "node:fs";
import type { SecurityStatus } from "@bukitjalil/shared";
import type { Logger } from "../log.ts";
import { SiteError } from "../sites/location.ts";
import { type Db, openDatabase, rekeyDatabase, WrongPinError } from "../store/db.ts";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

export interface SecurityOptions {
  /** app.db; null for `pnpm dev` and tests, where the database is plain and never locked. */
  file: string | null;
  logger: Logger;
  /** Called once, with the database the first correct PIN opened: the server starts its services then. */
  onOpen: (db: Db) => void;
  /** Called when the app locks: the server ends its event streams then. */
  onLock?: () => void;
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
 */
export class SecurityService {
  private db: Db | null = null;
  private locked = true;
  private failures = 0;
  private retryAt = 0;
  private verifier: Verifier | null = null;
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

  isLocked(): boolean {
    return this.mode === "pin" && (this.locked || this.db === null);
  }

  status(): SecurityStatus {
    if (this.mode === "dev") return { mode: "dev", pinSet: false, locked: false, retryAfterSeconds: 0 };
    return {
      mode: "pin",
      pinSet: this.pinSet(),
      locked: this.isLocked(),
      retryAfterSeconds: Math.max(0, Math.ceil((this.retryAt - this.now()) / 1000)),
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
    this.opts.logger.log("info", "security.unlock", {});
    return this.status();
  }

  lock(): SecurityStatus {
    this.requireFile();
    if (this.db && !this.locked) {
      this.locked = true;
      this.opts.logger.log("info", "security.lock", {});
      this.opts.onLock?.();
    }
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

function scrypt(pin: string, salt: Buffer): Buffer {
  return crypto.scryptSync(pin, salt, 32);
}

function hashPin(pin: string): Verifier {
  const salt = crypto.randomBytes(16);
  return { salt, hash: scrypt(pin, salt) };
}
