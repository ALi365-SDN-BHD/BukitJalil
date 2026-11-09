import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAdminApp } from "../src/app.ts";
import { BukitService } from "../src/bukit/locate.ts";
import { GitRunner, resolveGitPath } from "../src/git/run.ts";
import type { GitHealth } from "../src/git/version.ts";
import { type Logger, silentLogger } from "../src/log.ts";
import { ensureAppHome } from "../src/paths.ts";
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
    /** App data directory; a fresh temp directory by default. */
    appHome?: string;
    /** Home directory for the directory picker and location rules. */
    userHome?: string;
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
  const git = new GitRunner({
    gitPath: resolveGitPath() ?? "/nonexistent/git",
    home: paths.home,
    emptyFile: paths.emptyGitConfig,
    hooksDir: paths.emptyHooks,
    ceilingDirs: [paths.home],
  });
  const sites = new SiteService({
    db,
    git,
    paths,
    settings: new SettingsStore(db),
    bukit,
    locks: new SiteLocks(),
    templateDir: path.resolve(import.meta.dirname, "../../../templates/starter"),
    userHome: overrides.userHome,
  });
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
    sites,
    readIdentity: async () => ({ name: "Global Name", email: "global@example.com" }),
    userHome: overrides.userHome,
    version: "test",
    logger: overrides.logger ?? silentLogger,
  });
  return { app, db, loginToken, sites, paths, git };
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
