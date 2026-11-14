import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SecretCredentialStore } from "../src/agent/secret-credentials.ts";
import { type DesktopChannel, type DesktopInbound, type DesktopOutbound, requestSecretKey } from "../src/desktop.ts";
import { SecretBox, SecretBoxError } from "../src/secrets/box.ts";
import { type SecretFileSpec, SecretStore } from "../src/secrets/store.ts";
import { JsonFileError } from "../src/store/json-file.ts";

// Plan 6.7: tokens and model keys encrypted with the desktop app's keychain key.

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bj-secrets-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const spec = (name: string): SecretFileSpec => ({
  plain: path.join(dir, `${name}.json`),
  encrypted: path.join(dir, `${name}.enc.json`),
  purpose: name,
});
const key = () => randomBytes(32);

describe("SecretBox", () => {
  it("opens only its own sealing of the same purpose", () => {
    const k = key();
    const box = new SecretBox(k);
    const sealed = box.seal("ghp_secret", "tokens");
    expect(JSON.stringify(sealed)).not.toContain("ghp_secret");
    expect(box.open(sealed, "tokens")).toBe("ghp_secret");
    expect(() => box.open(sealed, "other")).toThrow(SecretBoxError);
    expect(() => new SecretBox(key()).open(sealed, "tokens")).toThrow(SecretBoxError);
    const data = Buffer.from(sealed.data, "base64");
    data[0] = (data[0] ?? 0) ^ 1;
    expect(() => box.open({ ...sealed, data: data.toString("base64") }, "tokens")).toThrow(SecretBoxError);
    expect(() => box.open({ v: 1 }, "tokens")).toThrow(SecretBoxError);
    expect(() => new SecretBox(Buffer.alloc(16))).toThrow(SecretBoxError);
  });
});

describe("SecretStore", () => {
  it("encrypts what it saves and reads it back", () => {
    const file = SecretStore.encrypted(key()).file(spec("tokens"));
    expect(file.read()).toBeUndefined();
    file.write({ a: "ntn_secret" });
    expect(file.read()).toEqual({ a: "ntn_secret" });
    expect(fs.readFileSync(path.join(dir, "tokens.enc.json"), "utf8")).not.toContain("ntn_secret");
    expect(fs.existsSync(path.join(dir, "tokens.json"))).toBe(false);
    expect(fs.statSync(path.join(dir, "tokens.enc.json")).mode & 0o777).toBe(0o600);
  });

  it("refuses a file encrypted with another key or for another purpose", () => {
    SecretStore.encrypted(key()).file(spec("tokens")).write({ a: "x" });
    expect(() => SecretStore.encrypted(key()).file(spec("tokens")).read()).toThrow(JsonFileError);
    const k = key();
    SecretStore.encrypted(k).file(spec("a")).write({ a: "x" });
    fs.copyFileSync(path.join(dir, "a.enc.json"), path.join(dir, "b.enc.json"));
    expect(() => SecretStore.encrypted(k).file(spec("b")).read()).toThrow(JsonFileError);
  });

  it("keeps plain files in plain mode", () => {
    const file = SecretStore.plain().file(spec("tokens"));
    file.write({ a: "x" });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "tokens.json"), "utf8"))).toEqual({ a: "x" });
  });

  it("without a key reads old plain files and saves nothing", () => {
    fs.writeFileSync(path.join(dir, "old.json"), JSON.stringify({ a: "x" }));
    const store = SecretStore.unavailable("no_keyring");
    expect(store.file(spec("old")).read()).toEqual({ a: "x" });
    expect(() => store.file(spec("old")).write({ a: "y" })).toThrow(/secrets.unavailable/);
    expect(store.file(spec("none")).read()).toBeUndefined();
    // An encrypted file it cannot open is not shown as empty.
    fs.writeFileSync(path.join(dir, "locked.enc.json"), "{}");
    expect(() => store.file(spec("locked")).read()).toThrow(/secrets.unavailable/);
    expect(store.status()).toEqual({ mode: "unavailable", reason: "no_keyring", plainFiles: true });
  });

  it("waits for the desktop app's key: pending until unlocked, then encrypts with it", () => {
    const k = key();
    const sealed = SecretStore.encrypted(k).file(spec("tokens"));
    sealed.write({ a: "x" });
    const store = SecretStore.pending();
    // Taken before the key arrives, like the services made at startup.
    const file = store.file(spec("tokens"));
    expect(store.status()).toEqual({ mode: "unavailable", reason: "pending", plainFiles: false });
    expect(() => file.read()).toThrow(/secrets.pending/);
    expect(() => file.write({ a: "y" })).toThrow(/secrets.pending/);
    expect(file.writable?.()).toBe(false);
    expect(() => store.reset()).toThrow(/secrets.pending/);
    store.unlock(k);
    expect(store.status()).toEqual({ mode: "encrypted", reason: null, plainFiles: false });
    expect(file.read()).toEqual({ a: "x" });
    file.write({ a: "y" });
    expect(sealed.read()).toEqual({ a: "y" });
    expect(file.file).toBe(path.join(dir, "tokens.enc.json"));
    // Settled once: a later answer changes nothing.
    store.fail("locked");
    store.unlock(key());
    expect(file.read()).toEqual({ a: "y" });
  });

  it("stays unavailable when the desktop app has no key", () => {
    fs.writeFileSync(path.join(dir, "old.json"), JSON.stringify({ a: "x" }));
    const store = SecretStore.pending();
    const file = store.file(spec("old"));
    store.fail("locked");
    expect(store.status()).toEqual({ mode: "unavailable", reason: "locked", plainFiles: true });
    expect(file.read()).toEqual({ a: "x" });
    expect(() => file.write({ a: "y" })).toThrow(/secrets.unavailable/);
    store.unlock(key());
    expect(store.status().mode).toBe("unavailable");
  });

  describe("migrate", () => {
    const logs: string[] = [];
    const log = (event: string) => logs.push(event);
    beforeEach(() => {
      logs.length = 0;
    });

    it("encrypts a plain file and removes it", () => {
      fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify({ a: "secret" }));
      const store = SecretStore.encrypted(key());
      const file = store.file(spec("tokens"));
      store.migrate(log);
      expect(fs.existsSync(path.join(dir, "tokens.json"))).toBe(false);
      expect(file.read()).toEqual({ a: "secret" });
      expect(logs).toEqual(["secrets.migrated"]);
      expect(store.status().plainFiles).toBe(false);
    });

    it("finishes a migration that stopped before removing the plain file", () => {
      const k = key();
      SecretStore.encrypted(k).file(spec("tokens")).write({ a: "same" });
      fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify({ a: "same" }));
      const store = SecretStore.encrypted(k);
      store.file(spec("tokens"));
      store.migrate(log);
      expect(fs.existsSync(path.join(dir, "tokens.json"))).toBe(false);
    });

    it("merges token files that differ, the plain entry winning, and never loses either", () => {
      const k = key();
      SecretStore.encrypted(k)
        .file({ ...spec("tokens"), mergeByKey: true })
        .write({ a: "desktop", b: "old" });
      // Saved by a server without the keychain (pnpm dev on the same data directory).
      fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify({ b: "new", c: "dev" }));
      const store = SecretStore.encrypted(k);
      const tokens = store.file({ ...spec("tokens"), mergeByKey: true });
      store.migrate(log);
      expect(tokens.read()).toEqual({ a: "desktop", b: "new", c: "dev" });
      expect(fs.existsSync(path.join(dir, "tokens.json"))).toBe(false);
    });

    it("keeps both files when they differ and cannot be merged, or the encrypted one cannot be read", () => {
      const k = key();
      SecretStore.encrypted(k)
        .file(spec("models"))
        .write({ providers: [{ id: "a" }] });
      fs.writeFileSync(path.join(dir, "models.json"), JSON.stringify({ providers: [{ id: "b" }] }));
      fs.writeFileSync(path.join(dir, "other.enc.json"), "{}");
      fs.writeFileSync(path.join(dir, "other.json"), JSON.stringify({ b: "kept" }));
      const store = SecretStore.encrypted(k);
      const models = store.file(spec("models"));
      store.file({ ...spec("other"), mergeByKey: true });
      store.migrate(log);
      expect(models.read()).toEqual({ providers: [{ id: "a" }] });
      expect(fs.existsSync(path.join(dir, "models.json"))).toBe(true);
      expect(fs.readFileSync(path.join(dir, "other.enc.json"), "utf8")).toBe("{}");
      expect(fs.existsSync(path.join(dir, "other.json"))).toBe(true);
      expect(logs).toEqual(["secrets.migrate_failed", "secrets.migrate_failed"]);
      expect(store.status().plainFiles).toBe(true);
    });

    it("leaves a plain file it cannot read", () => {
      fs.writeFileSync(path.join(dir, "tokens.json"), "not json ntn_secret");
      const store = SecretStore.encrypted(key());
      store.file(spec("tokens"));
      store.migrate((event, data) => logs.push(`${event} ${JSON.stringify(data)}`));
      expect(fs.existsSync(path.join(dir, "tokens.json"))).toBe(true);
      expect(logs.join()).toContain("secrets.migrate_failed");
      expect(logs.join()).not.toContain("ntn_secret");
      expect(store.status().plainFiles).toBe(true);
    });
  });

  it("removes temp files of the plain file an older version left", () => {
    fs.writeFileSync(path.join(dir, ".tokens.json-abc123.tmp"), "ghp_plain");
    expect(SecretStore.encrypted(key()).file(spec("tokens")).cleanupTempFiles()).toBe(1);
    expect(fs.existsSync(path.join(dir, ".tokens.json-abc123.tmp"))).toBe(false);
  });

  it("reset removes the encrypted and plain files and stops saving", () => {
    const store = SecretStore.encrypted(key());
    const file = store.file(spec("tokens"));
    file.write({ a: "x" });
    fs.writeFileSync(path.join(dir, "tokens.json"), "{}");
    store.reset();
    expect(fs.existsSync(path.join(dir, "tokens.enc.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "tokens.json"))).toBe(false);
    expect(file.read()).toBeUndefined();
    expect(() => file.write({ a: "y" })).toThrow(/secrets.unavailable/);
    expect(store.status()).toMatchObject({ mode: "unavailable", reason: "reset" });
    expect(() => SecretStore.plain().reset()).toThrow(/secrets.reset_unsupported/);
  });
});

describe("SecretCredentialStore", () => {
  it("keeps Pi's credentials in the encrypted file", async () => {
    const file = SecretStore.encrypted(key()).file(spec("pi-auth"));
    const store = new SecretCredentialStore(file);
    expect(await store.read("openai")).toBeUndefined();
    const saved = await store.modify("openai", async () => ({ type: "api_key", key: "sk-secret-1234" }));
    expect(saved).toEqual({ type: "api_key", key: "sk-secret-1234" });
    await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-ant" }));
    expect(await store.list()).toEqual([
      { providerId: "openai", type: "api_key" },
      { providerId: "anthropic", type: "api_key" },
    ]);
    // undefined leaves the entry as it was.
    expect(await store.modify("openai", async () => undefined)).toEqual(saved);
    await store.delete("openai");
    expect(store.readNow("openai")).toBeUndefined();
    expect(store.readNow("anthropic")).toEqual({ type: "api_key", key: "sk-ant" });
    expect(fs.readFileSync(path.join(dir, "pi-auth.enc.json"), "utf8")).not.toContain("sk-ant");
  });

  it("without a key refuses a write before Pi's function runs", async () => {
    fs.writeFileSync(path.join(dir, "pi-auth.json"), JSON.stringify({ x: { type: "api_key", key: "old" } }));
    const store = new SecretCredentialStore(SecretStore.unavailable("locked").file(spec("pi-auth")));
    expect(await store.read("x")).toEqual({ type: "api_key", key: "old" });
    let ran = false;
    await expect(
      store.modify("x", async () => {
        ran = true;
        return { type: "api_key", key: "new" };
      }),
    ).rejects.toThrow(/secrets.unavailable/);
    expect(ran).toBe(false);
  });

  it("while the key is on its way says so, and works once it arrives", async () => {
    const k = key();
    const secrets = SecretStore.pending();
    const store = new SecretCredentialStore(secrets.file(spec("pi-auth")));
    await expect(store.modify("x", async () => ({ type: "api_key", key: "new" }))).rejects.toThrow(/secrets.pending/);
    secrets.unlock(k);
    await store.modify("x", async () => ({ type: "api_key", key: "new" }));
    expect(await store.read("x")).toEqual({ type: "api_key", key: "new" });
  });

  it("serializes writes, and a failed one does not block the next", async () => {
    const store = new SecretCredentialStore(SecretStore.encrypted(key()).file(spec("pi-auth")));
    const writes = Array.from({ length: 5 }, (_, i) =>
      store.modify(`p${i}`, async () => ({ type: "api_key", key: `k${i}` })),
    );
    const failed = store.modify("bad", async () => {
      throw new Error("boom");
    });
    await Promise.all(writes);
    await expect(failed).rejects.toThrow("boom");
    await store.modify("after", async () => ({ type: "api_key", key: "ok" }));
    expect((await store.list()).map((c) => c.providerId)).toEqual(["p0", "p1", "p2", "p3", "p4", "after"]);
  });
});

describe("requestSecretKey", () => {
  function channel(answer: (send: (m: DesktopInbound) => void) => void): DesktopChannel & { sent: DesktopOutbound[] } {
    const handlers: ((m: DesktopInbound) => void)[] = [];
    const sent: DesktopOutbound[] = [];
    return {
      sent,
      send: (m) => {
        sent.push(m);
        answer((reply) => {
          for (const h of handlers) h(reply);
        });
      },
      onMessage: (h) => handlers.push(h),
      onClose: () => {},
    };
  }

  it("asks over the channel and takes a 32-byte key", async () => {
    const k = key();
    const c = channel((reply) => reply({ type: "secrets", key: k.toString("base64"), reason: null }));
    const answer = await requestSecretKey(c);
    expect(c.sent).toEqual([{ type: "secrets" }]);
    expect("key" in answer && answer.key.equals(k)).toBe(true);
  });

  it("passes on why there is no key, and gives up when nobody answers", async () => {
    const none = channel((reply) => reply({ type: "secrets", key: null, reason: "no_keyring" }));
    expect(await requestSecretKey(none)).toEqual({ reason: "no_keyring" });
    const short = channel((reply) => reply({ type: "secrets", key: "c2hvcnQ=", reason: null }));
    expect(await requestSecretKey(short)).toEqual({ reason: "locked" });
    const silent = channel(() => {});
    expect(await requestSecretKey(silent, 20)).toEqual({ reason: "no_answer" });
  });

  it("without a deadline waits however long the keychain prompt stays open", async () => {
    const k = key();
    let later: (() => void) | null = null;
    const slow = channel((reply) => {
      later = () => reply({ type: "secrets", key: k.toString("base64"), reason: null });
    });
    const asked = requestSecretKey(slow, null);
    await new Promise((resolve) => setTimeout(resolve, 30));
    (later as (() => void) | null)?.();
    const answer = await asked;
    expect("key" in answer && answer.key.equals(k)).toBe(true);
  });
});
