import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLockedApp } from "../src/app.ts";
import { silentLogger } from "../src/log.ts";
import { SecurityService } from "../src/security/pin.ts";
import { LoginToken } from "../src/security/token.ts";
import { SiteError } from "../src/sites/location.ts";
import type { Db } from "../src/store/db.ts";
import { ADMIN, makeApp, PORT, req, SESSION, TOKEN } from "./helpers.ts";

/** An empty app.db, as ensureAppHome leaves it before the first PIN. */
function emptyDb(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bj-pin-")), "app.db");
  fs.writeFileSync(file, "", { mode: 0o600 });
  return file;
}

function service(file: string | null, clock = { now: 0 }) {
  const opened: Db[] = [];
  let locks = 0;
  const security = new SecurityService({
    file,
    logger: silentLogger,
    onOpen: (db) => opened.push(db),
    onLock: () => {
      locks += 1;
    },
    now: () => clock.now,
  });
  return { security, opened, locks: () => locks };
}

function codeOf(fn: () => unknown): { code: string; status: number; params: Record<string, string> } {
  try {
    fn();
  } catch (err) {
    if (err instanceof SiteError) return { code: err.code, status: err.status, params: err.params };
    throw err;
  }
  throw new Error("did not throw");
}

const jsonPost = (body: unknown) => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
});

describe("SecurityService (plan 6.9)", () => {
  it("has no PIN in development mode", () => {
    const { security } = service(null);
    expect(security.status()).toEqual({ mode: "dev", pinSet: false, locked: false, retryAfterSeconds: 0 });
    expect(security.isLocked()).toBe(false);
    for (const call of [() => security.setup("1234"), () => security.unlock("1234"), () => security.lock()]) {
      expect(codeOf(call)).toMatchObject({ code: "security.dev_mode", status: 409 });
    }
  });

  it("creates an encrypted database with the first PIN and opens the services once", () => {
    const file = emptyDb();
    const { security, opened } = service(file);
    expect(security.status()).toMatchObject({ mode: "pin", pinSet: false, locked: true });
    expect(codeOf(() => security.unlock("1234"))).toMatchObject({ code: "security.pin_not_set", status: 409 });

    expect(security.setup("1234")).toMatchObject({ pinSet: true, locked: false });
    expect(opened).toHaveLength(1);
    expect(fs.readFileSync(file).subarray(0, 15).toString()).not.toBe("SQLite format 3");
    expect(codeOf(() => security.setup("5678"))).toMatchObject({ code: "security.pin_set", status: 409 });

    // Locking keeps the database open; unlocking checks the PIN against the in-memory hash.
    expect(security.lock()).toMatchObject({ locked: true });
    expect(codeOf(() => security.unlock("9999"))).toMatchObject({ code: "security.wrong_pin", status: 403 });
    expect(security.unlock("1234")).toMatchObject({ locked: false });
    expect(opened).toHaveLength(1);
  });

  it("ends the event streams when it locks, once", () => {
    const { security, locks } = service(emptyDb());
    security.setup("1234");
    security.lock();
    security.lock();
    expect(locks()).toBe(1);
  });

  it("opens an existing database only with its PIN, and waits five minutes after five wrong ones", () => {
    const file = emptyDb();
    service(file).security.setup("246810");
    const clock = { now: 1_000_000 };
    const { security, opened } = service(file, clock);
    expect(security.status()).toMatchObject({ pinSet: true, locked: true });
    for (let i = 0; i < 4; i++) {
      expect(codeOf(() => security.unlock("1111"))).toMatchObject({ code: "security.wrong_pin" });
    }
    expect(codeOf(() => security.unlock("1111"))).toMatchObject({
      code: "security.retry_later",
      status: 429,
      params: { seconds: "300" },
    });
    // Even the right PIN waits.
    clock.now += 60_000;
    expect(codeOf(() => security.unlock("246810"))).toMatchObject({
      code: "security.retry_later",
      params: { seconds: "240" },
    });
    expect(security.status().retryAfterSeconds).toBe(240);
    expect(opened).toHaveLength(0);
    clock.now += 240_000;
    expect(security.unlock("246810")).toMatchObject({ locked: false, retryAfterSeconds: 0 });
    expect(opened).toHaveLength(1);
  });

  it("changes the PIN by encrypting the database again", () => {
    const file = emptyDb();
    const first = service(file).security;
    first.setup("1234");
    expect(codeOf(() => first.changePin("0000", "5678"))).toMatchObject({ code: "security.wrong_pin" });
    first.changePin("1234", "5678");
    first.lock();
    expect(codeOf(() => first.changePin("5678", "1234"))).toMatchObject({ code: "app.locked", status: 423 });
    expect(codeOf(() => first.unlock("1234"))).toMatchObject({ code: "security.wrong_pin" });
    expect(first.unlock("5678")).toMatchObject({ locked: false });

    const again = service(file).security;
    expect(codeOf(() => again.unlock("1234"))).toMatchObject({ code: "security.wrong_pin" });
    expect(again.unlock("5678")).toMatchObject({ locked: false });
  });
});

describe("the API while locked (plan 6.9)", () => {
  it("answers only health and the lock before the database is open", async () => {
    const security = service(emptyDb()).security;
    const app = createLockedApp({
      port: PORT,
      allowedOrigin: ADMIN,
      loginToken: new LoginToken(TOKEN),
      sessionValue: SESSION,
      webDist: null,
      checkGit: async () => ({ ok: true, version: "2.45.0", problem: null }),
      version: "test",
      logger: silentLogger,
      security,
    });
    expect((await app.fetch(req("/api/health"))).status).toBe(200);
    expect(await (await app.fetch(req("/api/security"))).json()).toMatchObject({ pinSet: false, locked: true });
    for (const p of ["/api/settings", "/api/sites", "/api/events", "/api/publish-accounts"]) {
      const res = await app.fetch(req(p));
      expect(res.status).toBe(423);
      expect(await res.json()).toEqual({ code: "app.locked" });
    }
    // The lock keeps the login rules: no cookie, no answer.
    expect((await app.fetch(req("/api/security", { cookie: false }))).status).toBe(401);
    expect((await app.fetch(req("/api/security/setup", jsonPost({ pin: "12a4" })))).status).toBe(400);
    const setup = await app.fetch(req("/api/security/setup", jsonPost({ pin: "1234" })));
    expect(setup.status).toBe(200);
    expect(await setup.json()).toMatchObject({ pinSet: true, locked: false });
  });

  it("refuses every other request while locked and answers again after unlocking", async () => {
    const security = service(emptyDb()).security;
    security.setup("1234");
    const { app } = makeApp({ security });
    expect((await app.fetch(req("/api/settings"))).status).toBe(200);

    expect(await (await app.fetch(req("/api/security/lock", jsonPost({})))).json()).toMatchObject({ locked: true });
    expect((await app.fetch(req("/api/settings"))).status).toBe(423);
    expect((await app.fetch(req("/api/events"))).status).toBe(423);
    expect((await app.fetch(req("/api/health"))).status).toBe(200);

    const wrong = await app.fetch(req("/api/security/unlock", jsonPost({ pin: "4321" })));
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ code: "security.wrong_pin" });
    expect((await app.fetch(req("/api/security/unlock", jsonPost({ pin: "1234" })))).status).toBe(200);
    expect((await app.fetch(req("/api/settings"))).status).toBe(200);

    const change = await app.fetch(req("/api/security/change-pin", jsonPost({ currentPin: "1234", nextPin: "8765" })));
    expect(change.status).toBe(200);
  });
});
