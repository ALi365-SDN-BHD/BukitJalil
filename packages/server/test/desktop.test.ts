import { type ChildProcess, execFileSync, fork, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BUKIT_VERSION } from "../src/bukit/install.ts";
import type { DesktopOutbound } from "../src/desktop.ts";
import { acquireHomeLock, HomeInUseError } from "../src/lock.ts";
import { resolveResources } from "../src/paths.ts";

const SERVER_DIR = path.resolve(import.meta.dirname, "..");
const MAIN = path.join(SERVER_DIR, "src", "main.ts");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bj-desktop-"));

/** A pid that certainly does not run any more. */
function deadPid(): number {
  return Number(
    execFileSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }),
  );
}

describe("data directory lock (plan M7)", () => {
  it("is taken, refused to a second live process and released", () => {
    const file = path.join(tmp(), "server.lock");
    const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    try {
      const release = acquireHomeLock(file, sleeper.pid);
      expect(fs.readFileSync(file, "utf8")).toBe(`${sleeper.pid}\n`);
      expect(() => acquireHomeLock(file)).toThrow(HomeInUseError);
      release();
      expect(fs.existsSync(file)).toBe(false);
      const mine = acquireHomeLock(file);
      expect(fs.readFileSync(file, "utf8")).toBe(`${process.pid}\n`);
      mine();
    } finally {
      sleeper.kill();
    }
  });

  it("takes over a stale lock, but not one that is still being written", () => {
    const file = path.join(tmp(), "server.lock");
    const backdate = (content: string) => {
      fs.writeFileSync(file, content);
      const old = new Date(Date.now() - 10_000);
      fs.utimesSync(file, old, old);
    };
    backdate(`${deadPid()}\n`);
    acquireHomeLock(file)();
    backdate("garbage");
    acquireHomeLock(file)();

    // The file appears before its PID is written; a fresh empty file must not be deleted.
    fs.writeFileSync(file, "");
    expect(() => acquireHomeLock(file)).toThrow(HomeInUseError);
    backdate("garbage");
    acquireHomeLock(file)();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("takes over a fresh lock of a crashed process at once, but not a fresh partial PID", () => {
    const file = path.join(tmp(), "server.lock");
    // Right after a crash the lock is still new; "Start again" must not wait for the grace period.
    fs.writeFileSync(file, `${deadPid()}\n`);
    acquireHomeLock(file)();
    expect(fs.existsSync(file)).toBe(false);

    // Without its newline the PID may still be mid-write.
    fs.writeFileSync(file, String(deadPid()));
    expect(() => acquireHomeLock(file)).toThrow(HomeInUseError);
  });

  it("does not remove a lock another process has taken over since", () => {
    const file = path.join(tmp(), "server.lock");
    const release = acquireHomeLock(file);
    fs.writeFileSync(file, "12345\n");
    release();
    expect(fs.readFileSync(file, "utf8")).toBe("12345\n");
  });
});

describe("resource folders (plan M7)", () => {
  it("come from the repository unless BUKITJALIL_RESOURCES names the desktop app's", () => {
    expect(resolveResources("/repo", {})).toEqual({
      skills: path.join("/repo", "skills"),
      web: path.join("/repo", "packages/web/dist"),
      bukit: path.join("/repo", `vendor/bukit-${BUKIT_VERSION}`),
      themeDemo: path.join("/repo", "packages/server/assets/theme-demo"),
    });
    expect(resolveResources("/repo", { BUKITJALIL_RESOURCES: "/App/Resources/app" })).toEqual({
      skills: path.resolve("/App/Resources/app", "skills"),
      web: path.resolve("/App/Resources/app", "web"),
      bukit: path.resolve("/App/Resources/app", "bukit"),
      themeDemo: path.resolve("/App/Resources/app", "theme-demo"),
    });
  });
});

const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
});

/**
 * main.ts started as the desktop app starts it, with an IPC channel in place of Electron's parentPort.
 * Tests here use ports 46700-46769, apart from the preview pools of the other test files (48810+, 49500+),
 * which run in parallel.
 */
function startDesktop(home: string, port: number) {
  const child = fork(MAIN, ["--desktop", "--port", String(port), "--preview-port-base", String(port + 1)], {
    cwd: SERVER_DIR,
    execArgv: ["--import", "tsx", "--no-warnings"],
    env: { PATH: process.env.PATH, HOME: home, BUKITJALIL_HOME: home },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.push(child);
  let stdout = "";
  child.stdout?.on("data", (d) => {
    stdout += d;
  });
  const next = (type: DesktopOutbound["type"]) =>
    new Promise<DesktopOutbound>((resolve, reject) => {
      const onMessage = (m: DesktopOutbound) => {
        if (m.type === type || m.type === "error") {
          child.off("message", onMessage);
          resolve(m);
        }
      };
      child.on("message", onMessage);
      child.once("exit", (code) => reject(new Error(`server exited with ${code}`)));
    });
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  return { child, next, exited, stdout: () => stdout };
}

/** Log in with a link from the desktop channel; returns the session cookie. */
async function login(s: ReturnType<typeof startDesktop>): Promise<string> {
  s.child.send({ type: "login" });
  const link = (await s.next("login")) as { url: string };
  const res = await fetch(link.url, { redirect: "manual" });
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/** The first PIN (plan 6.9): the desktop server opens its database and starts its services then. */
async function setupPin(port: number, cookie: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/security/setup`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "x-bukitjalil": "1", origin: `http://127.0.0.1:${port}` },
    body: JSON.stringify({ pin: "1234" }),
  });
}

describe("desktop mode (plan M7)", () => {
  it("reports ready, hands out login links on request and shuts down when asked", async () => {
    const home = tmp();
    const s = startDesktop(home, 46700);
    expect(await s.next("ready")).toEqual({ type: "ready", port: 46700 });
    expect(fs.readFileSync(path.join(home, "server.lock"), "utf8")).toBe(`${s.child.pid}\n`);

    s.child.send({ type: "login" });
    const login = await s.next("login");
    expect(login).toMatchObject({
      type: "login",
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:46700\/\?token=[\w-]{20,}$/),
    });
    const res = await fetch((login as { url: string }).url, { redirect: "manual" });
    expect(res.headers.get("set-cookie")).toMatch(/^bj_session_46700=/);
    // Nothing is printed: the link only goes to the desktop app.
    expect(s.stdout()).not.toContain("token=");

    s.child.send({ type: "shutdown" });
    expect(await s.exited).toBe(0);
    expect(fs.existsSync(path.join(home, "server.lock"))).toBe(false);
  }, 30_000);

  it("stays locked until the first PIN, then keeps tokens only in the encrypted database", async () => {
    const home = tmp();
    const s = startDesktop(home, 46750);
    expect(await s.next("ready")).toMatchObject({ type: "ready" });
    const cookie = await login(s);
    const headers = {
      cookie,
      "content-type": "application/json",
      "x-bukitjalil": "1",
      origin: "http://127.0.0.1:46750",
    };
    // Locked until the first PIN (plan 6.9): the database stays closed.
    const security = await fetch("http://127.0.0.1:46750/api/security", { headers: { cookie } });
    expect(await security.json()).toEqual({ mode: "pin", pinSet: false, locked: true, retryAfterSeconds: 0 });
    expect((await fetch("http://127.0.0.1:46750/api/publish-accounts", { headers: { cookie } })).status).toBe(423);
    expect(fs.statSync(path.join(home, "app.db")).size).toBe(0);

    expect((await setupPin(46750, cookie)).status).toBe(200);
    const token = "ghp_desktoptoken123456";
    const created = await fetch("http://127.0.0.1:46750/api/publish-accounts", {
      method: "POST",
      headers,
      body: JSON.stringify({ platform: "github", name: "Work", token }),
    });
    expect(created.status).toBe(200);
    s.child.send({ type: "shutdown" });
    expect(await s.exited).toBe(0);

    // Nothing outside the database holds the token, and the database is not plain SQLite.
    const files = fs.readdirSync(home, { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
    for (const file of files) {
      expect(fs.readFileSync(path.join(file.parentPath, file.name)).includes(token), file.name).toBe(false);
    }
    expect(fs.readFileSync(path.join(home, "app.db")).subarray(0, 15).toString()).not.toBe("SQLite format 3");
  }, 30_000);

  it("shuts down when the desktop app goes away without asking", async () => {
    const home = tmp();
    const s = startDesktop(home, 46740);
    expect(await s.next("ready")).toMatchObject({ type: "ready" });
    s.child.disconnect();
    expect(await s.exited).toBe(0);
    expect(fs.existsSync(path.join(home, "server.lock"))).toBe(false);
  }, 30_000);

  it("refuses a data directory another server is using", async () => {
    const home = tmp();
    const first = startDesktop(home, 46710);
    expect(await first.next("ready")).toMatchObject({ type: "ready" });
    const second = startDesktop(home, 46720);
    const err = await second.next("ready");
    expect(err).toMatchObject({
      type: "error",
      code: "home_in_use",
      message: expect.stringContaining(String(first.child.pid)),
    });
    expect(await second.exited).toBe(1);
    expect(fs.readFileSync(path.join(home, "server.lock"), "utf8")).toBe(`${first.child.pid}\n`);
  }, 30_000);

  it("says when its port is taken, so the desktop app can try another", async () => {
    const blocker = net.createServer().listen(46730, "127.0.0.1");
    await new Promise((r) => blocker.once("listening", r));
    try {
      const home = tmp();
      const s = startDesktop(home, 46730);
      expect(await s.next("ready")).toMatchObject({ type: "error", code: "port_in_use" });
      expect(await s.exited).toBe(1);
      // The lock does not outlive the failed start.
      expect(fs.existsSync(path.join(home, "server.lock"))).toBe(false);
    } finally {
      blocker.close();
    }
  }, 30_000);

  it("is refused without the desktop app's channel", () => {
    const home = tmp();
    const out = (() => {
      try {
        execFileSync(process.execPath, ["--import", "tsx", "--no-warnings", MAIN, "--desktop"], {
          cwd: SERVER_DIR,
          env: { PATH: process.env.PATH, HOME: home, BUKITJALIL_HOME: home },
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
        });
        return "started";
      } catch (err) {
        return String((err as { stderr?: string }).stderr);
      }
    })();
    expect(out).toContain("--desktop is only for the desktop app");
  });
});
