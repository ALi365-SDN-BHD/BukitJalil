import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The part of Electron's safeStorage used here, so tests can stand in for it. */
export interface KeychainStorage {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
  /** Linux only in Electron. */
  getSelectedStorageBackend?(): string;
}

export type SecretKeyAnswer = { key: string; reason: null } | { key: null; reason: "no_keyring" | "locked" };

export const KEY_FILE = "secret-key.enc";
const KEY_BYTES = 32;
/** Backends that are no real keychain: a fixed built-in password, or none found. */
const WEAK_BACKENDS = new Set(["basic_text", "unknown"]);

/**
 * The key the server encrypts tokens and model keys with (plan 6.7): 32 random bytes, kept in the data
 * directory encrypted by the system keychain (macOS Keychain, Windows DPAPI, Linux Secret Service). Made
 * on first use; never replaced when it exists but cannot be decrypted, so nothing saved is orphaned.
 */
export function loadSecretKey(
  dataDir: string,
  storage: KeychainStorage,
  platform: NodeJS.Platform = process.platform,
): SecretKeyAnswer {
  if (!storage.isEncryptionAvailable()) return { key: null, reason: "no_keyring" };
  if (platform === "linux" && WEAK_BACKENDS.has(storage.getSelectedStorageBackend?.() ?? "unknown")) {
    return { key: null, reason: "no_keyring" };
  }
  const file = path.join(dataDir, KEY_FILE);
  let sealed: Buffer | null = null;
  try {
    sealed = fs.readFileSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return { key: null, reason: "locked" };
  }
  if (sealed) {
    try {
      const key = storage.decryptString(sealed);
      if (Buffer.from(key, "base64").length !== KEY_BYTES) return { key: null, reason: "locked" };
      return { key, reason: null };
    } catch {
      return { key: null, reason: "locked" };
    }
  }
  const key = randomBytes(KEY_BYTES).toString("base64");
  try {
    writeKeyFile(file, storage.encryptString(key));
  } catch {
    return { key: null, reason: "locked" };
  }
  return { key, reason: null };
}

/** Forget the key; a new one is made the next time the server asks (plan 6.7). */
export function removeSecretKey(dataDir: string): void {
  fs.rmSync(path.join(dataDir, KEY_FILE), { force: true });
}

/** Written once (only when there is none), 0600, to a temporary name and renamed. */
function writeKeyFile(file: string, data: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const fd = fs.openSync(temp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, data);
      fs.fchmodSync(fd, 0o600);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // One desktop app runs at a time (single-instance lock), so nothing else writes the key meanwhile.
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
