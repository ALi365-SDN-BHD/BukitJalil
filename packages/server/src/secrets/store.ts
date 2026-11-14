import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type { SecretsMode, SecretsStatus, SecretsUnavailableReason } from "@bukitjalil/shared";
import { isRecord } from "../bukit/guard.ts";
import { SiteError } from "../sites/location.ts";
import { JsonFile, JsonFileError, type StoredJson } from "../store/json-file.ts";
import { SecretBox, SecretBoxError } from "./box.ts";

/** One secret file: where it is kept unencrypted (old versions, dev) and encrypted, and what it is. */
export interface SecretFileSpec {
  plain: string;
  encrypted: string;
  /** Authenticated with the content, so files cannot be swapped. */
  purpose: string;
  maxBytes?: number;
  /**
   * A flat map (id → secret): when a plain file and an encrypted one disagree at migration, they are
   * merged by key, the plain entry winning. Otherwise both are kept for the user to sort out.
   */
  mergeByKey?: boolean;
}

const DEFAULT_MAX_BYTES = 256 * 1024;

/** Base64 grows text by 4/3; the envelope adds a little. */
const sealedLimit = (maxBytes: number) => Math.ceil((maxBytes * 4) / 3) + 1024;

/**
 * Where tokens and model keys are kept (plan 6.7): encrypted with the desktop app's keychain key, plain
 * 0600 files for `pnpm dev` and tests, or unavailable when the desktop app has no safe keychain (nothing
 * can be saved; old plain files are still read). The desktop server starts `pending` and does not wait for
 * the key: the app asks the keychain once its window shows the app, then `unlock` or `fail` settles it.
 */
export class SecretStore {
  private readonly specs: SecretFileSpec[] = [];
  private resetDone = false;

  private constructor(
    private startMode: SecretsMode,
    private box: SecretBox | null,
    private reason: SecretsUnavailableReason | null,
  ) {}

  static encrypted(key: Buffer): SecretStore {
    return new SecretStore("encrypted", new SecretBox(key), null);
  }

  static plain(): SecretStore {
    return new SecretStore("plain", null, null);
  }

  static unavailable(reason: SecretsUnavailableReason): SecretStore {
    return new SecretStore("unavailable", null, reason);
  }

  /** Waiting for the desktop app's key: like unavailable, until `unlock` or `fail`. */
  static pending(): SecretStore {
    return new SecretStore("unavailable", null, "pending");
  }

  get pending(): boolean {
    return this.reason === "pending";
  }

  /** The key arrived: from now on every file is encrypted with it. Only once, only while pending. */
  unlock(key: Buffer): void {
    if (!this.pending) return;
    this.box = new SecretBox(key);
    this.startMode = "encrypted";
    this.reason = null;
  }

  /** No key: stays unavailable for this reason. */
  fail(reason: SecretsUnavailableReason): void {
    if (this.pending) this.reason = reason;
  }

  /** After a reset nothing is saved until the app starts again with a new key. */
  get mode(): SecretsMode {
    return this.resetDone ? "unavailable" : this.startMode;
  }

  /** The file to read and write one kind of secret through. */
  file(spec: SecretFileSpec): StoredJson {
    this.specs.push(spec);
    const maxBytes = spec.maxBytes ?? DEFAULT_MAX_BYTES;
    const plain = new JsonFile(spec.plain, { maxBytes });
    if (this.startMode === "plain") return plain;
    const locked = new LockedJsonFile(spec, plain, () => this.reason);
    let encrypted: EncryptedJsonFile | null = null;
    // Picked on every call: a pending store unlocks later.
    return new SwitchingJsonFile(() => {
      if (!this.box) return locked;
      encrypted ??= new EncryptedJsonFile(spec, maxBytes, this.box, () => this.resetDone);
      return encrypted;
    });
  }

  status(): SecretsStatus {
    return {
      mode: this.mode,
      reason: this.resetDone ? "reset" : this.reason,
      plainFiles: this.startMode !== "plain" && this.specs.some((s) => fs.existsSync(s.plain)),
    };
  }

  /**
   * Forget every saved token and key (plan 6.7): the encrypted files are removed; the desktop app removes
   * its key and makes a new one at the next start. Not offered in plain mode, which has no key.
   */
  reset(): void {
    if (this.startMode === "plain") throw new SiteError("secrets.reset_unsupported", 409);
    // The desktop app may be reading the key right now; resetting is for a key that cannot be unlocked.
    if (this.pending) throw new SiteError("secrets.pending", 503);
    this.resetDone = true;
    for (const spec of this.specs) {
      fs.rmSync(spec.encrypted, { force: true });
      // Plain files left by an older version or a failed migration are forgotten too.
      fs.rmSync(spec.plain, { force: true });
      new JsonFile(spec.plain).cleanupTempFiles();
    }
  }

  /**
   * Encrypt the plain files left by an earlier version, check they read back the same, then remove the
   * plain ones (plan 6.7). Each file on its own; one that fails stays as it is and is logged.
   */
  migrate(log: (event: string, data: Record<string, string>) => void): void {
    if (!this.box) return;
    for (const spec of this.specs) {
      try {
        if (!fs.existsSync(spec.plain)) continue;
        const maxBytes = spec.maxBytes ?? DEFAULT_MAX_BYTES;
        const value = new JsonFile(spec.plain, { maxBytes }).read();
        if (value === undefined) continue;
        const encrypted = new EncryptedJsonFile(spec, maxBytes, this.box, () => false);
        // Both present: a migration stopped before removing the plain file, or a server without the
        // keychain (`pnpm dev` on the same data directory, an older version) saved a plain file again.
        // Neither may overwrite the other: merged by key where that is safe, else both kept.
        let current: unknown;
        try {
          current = fs.existsSync(spec.encrypted) ? encrypted.read() : undefined;
        } catch {
          log("secrets.migrate_failed", { purpose: spec.purpose, error: "encrypted file unreadable" });
          continue;
        }
        let next = value;
        if (current !== undefined && !isDeepStrictEqual(current, value)) {
          if (!spec.mergeByKey || !isRecord(current) || !isRecord(value)) {
            log("secrets.migrate_failed", { purpose: spec.purpose, error: "plain and encrypted files differ" });
            continue;
          }
          next = { ...current, ...value };
        }
        if (!isDeepStrictEqual(current, next)) {
          encrypted.write(next);
          if (!isDeepStrictEqual(encrypted.read(), next)) throw new Error("encrypted file does not read back");
        }
        fs.rmSync(spec.plain, { force: true });
        log("secrets.migrated", { purpose: spec.purpose });
      } catch (err) {
        // Never the file's text: it is the secret.
        log("secrets.migrate_failed", { purpose: spec.purpose, error: err instanceof Error ? err.name : "error" });
      }
    }
  }
}

/** Encrypted in place of the plain file; same contract as JsonFile. */
class EncryptedJsonFile implements StoredJson {
  private readonly inner: JsonFile;

  constructor(
    private readonly spec: SecretFileSpec,
    private readonly maxBytes: number,
    private readonly box: SecretBox,
    private readonly blocked: () => boolean,
  ) {
    this.inner = new JsonFile(spec.encrypted, { maxBytes: sealedLimit(maxBytes) });
  }

  get file(): string {
    return this.spec.encrypted;
  }

  writable(): boolean {
    return !this.blocked();
  }

  read(): unknown | undefined {
    if (this.blocked()) return undefined;
    const sealed = this.inner.read();
    if (sealed === undefined) return undefined;
    let text: string;
    try {
      text = this.box.open(sealed, this.spec.purpose);
    } catch (err) {
      if (err instanceof SecretBoxError) throw new JsonFileError(this.file, err.message);
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new JsonFileError(this.file, "invalid JSON");
    }
  }

  write(value: unknown): void {
    if (this.blocked()) throw new SiteError("secrets.unavailable", 503);
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > this.maxBytes) {
      throw new JsonFileError(this.file, "data is too large to save", "storage.too_large");
    }
    this.inner.write(this.box.seal(text, this.spec.purpose));
  }

  cleanupTempFiles(): number {
    // Temp files of the plain file an older version wrote hold tokens in plain text.
    return this.inner.cleanupTempFiles() + new JsonFile(this.spec.plain).cleanupTempFiles();
  }
}

/** Delegates to the file the store's current state picks (locked until a pending store unlocks). */
class SwitchingJsonFile implements StoredJson {
  constructor(private readonly pick: () => StoredJson) {}

  get file(): string {
    return this.pick().file;
  }

  writable(): boolean {
    return this.pick().writable?.() ?? true;
  }

  refusal(): "secrets.unavailable" | "secrets.pending" {
    return this.pick().refusal?.() ?? "secrets.unavailable";
  }

  read(): unknown | undefined {
    return this.pick().read();
  }

  write(value: unknown): void {
    this.pick().write(value);
  }

  cleanupTempFiles(): number {
    return this.pick().cleanupTempFiles();
  }
}

/**
 * No key: what an earlier version saved unencrypted can still be read, an encrypted file cannot, and
 * nothing is saved (plan 6.7). While the key is still on its way the error says so.
 */
class LockedJsonFile implements StoredJson {
  constructor(
    private readonly spec: SecretFileSpec,
    private readonly plain: JsonFile,
    private readonly reason: () => SecretsUnavailableReason | null,
  ) {}

  refusal(): "secrets.unavailable" | "secrets.pending" {
    return this.reason() === "pending" ? "secrets.pending" : "secrets.unavailable";
  }

  private error(): SiteError {
    return new SiteError(this.refusal(), 503);
  }

  get file(): string {
    return this.spec.plain;
  }

  writable(): boolean {
    return false;
  }

  read(): unknown | undefined {
    const value = this.plain.read();
    if (value !== undefined) return value;
    if (fs.existsSync(this.spec.encrypted)) throw this.error();
    return undefined;
  }

  write(): void {
    throw this.error();
  }

  cleanupTempFiles(): number {
    return this.plain.cleanupTempFiles();
  }
}
