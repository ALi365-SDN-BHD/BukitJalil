import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KEY_FILE, type KeychainStorage, loadSecretKey, removeSecretKey } from "./secrets.ts";

// Plan 6.7: the desktop app's secret key, kept encrypted by the system keychain.

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bj-desk-secrets-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A keychain that "encrypts" by reversing the bytes, so the file is not the key in plain text. */
function keychain(opts: { available?: boolean; backend?: string; fail?: boolean } = {}): KeychainStorage {
  return {
    isEncryptionAvailable: () => opts.available ?? true,
    getSelectedStorageBackend: () => opts.backend ?? "gnome_libsecret",
    encryptString: (text) => Buffer.from(text, "utf8").reverse(),
    decryptString: (data) => {
      if (opts.fail) throw new Error("denied");
      return Buffer.from(data).reverse().toString("utf8");
    },
  };
}

describe("loadSecretKey", () => {
  it("makes a key once and gives the same one afterwards", () => {
    const first = loadSecretKey(dir, keychain(), "darwin");
    expect(first.reason).toBeNull();
    expect(Buffer.from(first.key ?? "", "base64")).toHaveLength(32);
    const file = path.join(dir, KEY_FILE);
    expect(fs.readFileSync(file, "utf8")).not.toContain(first.key);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(loadSecretKey(dir, keychain(), "darwin")).toEqual(first);
  });

  it("refuses a missing or weak keychain", () => {
    expect(loadSecretKey(dir, keychain({ available: false }), "darwin")).toEqual({ key: null, reason: "no_keyring" });
    expect(loadSecretKey(dir, keychain({ backend: "basic_text" }), "linux")).toEqual({
      key: null,
      reason: "no_keyring",
    });
    expect(loadSecretKey(dir, keychain({ backend: "unknown" }), "linux")).toEqual({ key: null, reason: "no_keyring" });
    expect(fs.existsSync(path.join(dir, KEY_FILE))).toBe(false);
  });

  it("never replaces a key it cannot decrypt", () => {
    loadSecretKey(dir, keychain(), "darwin");
    const before = fs.readFileSync(path.join(dir, KEY_FILE));
    expect(loadSecretKey(dir, keychain({ fail: true }), "darwin")).toEqual({ key: null, reason: "locked" });
    expect(fs.readFileSync(path.join(dir, KEY_FILE)).equals(before)).toBe(true);
    fs.writeFileSync(path.join(dir, KEY_FILE), Buffer.from("c2hvcnQ=").reverse());
    expect(loadSecretKey(dir, keychain(), "darwin")).toEqual({ key: null, reason: "locked" });
  });

  it("makes a new key after a reset", () => {
    const first = loadSecretKey(dir, keychain(), "darwin");
    removeSecretKey(dir);
    const second = loadSecretKey(dir, keychain(), "darwin");
    expect(second.key).not.toBe(first.key);
  });
});
