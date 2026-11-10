import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { RgService } from "../src/agent/rg.ts";
import { createAdminApp } from "../src/app.ts";
import { BuildService } from "../src/builds/service.ts";
import { BukitService } from "../src/bukit/locate.ts";
import { GitRunner, resolveGitPath } from "../src/git/run.ts";
import type { GitHealth } from "../src/git/version.ts";
import { type Logger, silentLogger } from "../src/log.ts";
import { PanelService } from "../src/panels/service.ts";
import { ensureAppHome } from "../src/paths.ts";
import { PreviewPool } from "../src/preview/pool.ts";
import { LoginToken } from "../src/security/token.ts";
import { SiteLocks } from "../src/sites/locks.ts";
import { SiteService } from "../src/sites/service.ts";
import { openDatabase } from "../src/store/db.ts";
import { SettingsStore } from "../src/store/settings.ts";

export const PORT = 47880;
export const ADMIN = `http://127.0.0.1:${PORT}`;
export const TOKEN = "test-token-abcdefghijklmnopqrstuvwxyz";
export const SESSION = "test-session-0123456789abcdefghijklmn";
export const COOKIE = `bj_session_${PORT}`;

export function makeApp(
  overrides: {
    allowedOrigin?: string;
    webDist?: string;
    checkGit?: () => Promise<GitHealth>;
    logger?: Logger;
    bukit?: BukitService;
    rg?: RgService;
    /** App data directory; a fresh temp directory by default. */
    appHome?: string;
    /** Home directory for the directory picker and location rules. */
    userHome?: string;
    /** First preview port; tests that open previews pick their own range. */
    previewBase?: number;
  } = {},
) {
  const db = openDatabase(":memory:");
  const paths = ensureAppHome(overrides.appHome ?? fs.mkdtempSync(path.join(os.tmpdir(), "bj-app-")));
  const bukit =
    overrides.bukit ??
    new BukitService({
      home: "/nonexistent-bukitjalil-home",
      tmpDir: os.tmpdir(),
      customPath: () => null,
      envPath: "",
    });
  const rg = overrides.rg ?? new RgService({ piBin: paths.piBin });
  const git = new GitRunner({
    gitPath: resolveGitPath() ?? "/nonexistent/git",
    home: paths.home,
    emptyFile: paths.emptyGitConfig,
    hooksDir: paths.emptyHooks,
    ceilingDirs: [paths.home],
  });
  const locks = new SiteLocks();
  const logger = overrides.logger ?? silentLogger;
  const sites = new SiteService({
    db,
    git,
    paths,
    settings: new SettingsStore(db),
    bukit,
    locks,
    templateDir: path.resolve(import.meta.dirname, "../../../templates/starter"),
    userHome: overrides.userHome,
  });
  const previews = new PreviewPool(overrides.previewBase ?? 49500, new Set([PORT]), logger);
  const builds = new BuildService({ db, git, paths, sites, bukit, locks, previews, logger });
  const loginToken = new LoginToken(TOKEN);
  const app = createAdminApp({
    port: PORT,
    allowedOrigin: overrides.allowedOrigin ?? ADMIN,
    loginToken,
    sessionValue: SESSION,
    db,
    webDist: overrides.webDist ?? null,
    checkGit: overrides.checkGit ?? (async () => ({ ok: true, version: "2.45.0", problem: null })),
    bukit,
    rg,
    sites,
    panels: new PanelService({ git, sites }),
    builds,
    readIdentity: async () => ({ name: "Global Name", email: "global@example.com" }),
    userHome: overrides.userHome,
    version: "test",
    logger,
  });
  return { app, db, loginToken, sites, paths, git, builds, previews, locks, rg, bukit };
}

/** Build a request as the browser would send it to the admin port. */
export function req(path: string, init: RequestInit & { host?: string; cookie?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set("host", init.host ?? `127.0.0.1:${PORT}`);
  if (init.cookie !== false) headers.set("cookie", `${COOKIE}=${SESSION}`);
  return new Request(`${ADMIN}${path}`, { ...init, headers });
}

export const jsonPut = (body: unknown, extra: Record<string, string> = {}) => ({
  method: "PUT",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN, ...extra },
});

/** The system git with a fixed, minimal environment, for test fixtures (never the code under test). */
export function rawGit(home: string, cwd: string, ...args: string[]): string {
  return execFileSync(resolveGitPath() as string, args, {
    cwd,
    env: { PATH: "/usr/bin:/bin", HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    encoding: "utf8",
  });
}

/** `git add -A` and commit as a fixed test identity. */
export function commitAllAs(home: string, dir: string, message = "init"): void {
  rawGit(home, dir, "add", "-A");
  rawGit(home, dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", message);
}

/** A plain HTTP request to a preview port, without keep-alive (tests reuse ports). */
export function httpGet(port: number, opts: { host?: string; method?: string; path?: string } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const r = http.request(
      {
        host: "127.0.0.1",
        port,
        path: opts.path ?? "/",
        method: opts.method ?? "GET",
        agent: false,
        headers: { host: opts.host ?? `127.0.0.1:${port}` },
      },
      (res) => {
        let body = "";
        res.on("data", (d) => {
          body += d;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    r.on("error", reject);
    r.end();
  });
}
