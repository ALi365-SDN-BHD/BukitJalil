import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import { AiBukit } from "../src/agent/ai-bukit.ts";
import { NotionContentAgent } from "../src/agent/content-agent.ts";
import { CustomModelStore } from "../src/agent/custom-models.ts";
import { RgService } from "../src/agent/rg.ts";
import { SecretCredentialStore } from "../src/agent/secret-credentials.ts";
import { AgentService, type AgentServiceOptions } from "../src/agent/service.ts";
import type { EventStreamOptions } from "../src/api/events.ts";
import { createAdminApp } from "../src/app.ts";
import { BuildService } from "../src/builds/service.ts";
import { BukitService } from "../src/bukit/locate.ts";
import { ChangeService } from "../src/changes/service.ts";
import { DataSourceService } from "../src/data-sources/service.ts";
import { DeployService } from "../src/deploys/service.ts";
import { connectEvents } from "../src/events/bridge.ts";
import { EventHub } from "../src/events/hub.ts";
import { GitRunner, resolveGitPath } from "../src/git/run.ts";
import { GitService, type GitServiceOptions } from "../src/git/service.ts";
import type { GitHealth } from "../src/git/version.ts";
import { type Logger, silentLogger } from "../src/log.ts";
import { MediaService } from "../src/media/service.ts";
import { PanelService } from "../src/panels/service.ts";
import { ensureAppHome } from "../src/paths.ts";
import { PreviewPool } from "../src/preview/pool.ts";
import { ProjectRepos } from "../src/projects/repo.ts";
import { ProjectService } from "../src/projects/service.ts";
import { PublishAccountService } from "../src/publish/accounts.ts";
import type { SecurityService } from "../src/security/pin.ts";
import { LoginToken } from "../src/security/token.ts";
import { FieldVault } from "../src/security/vault.ts";
import { SiteLocks } from "../src/sites/locks.ts";
import { SiteService } from "../src/sites/service.ts";
import { openDatabase } from "../src/store/db.ts";
import { SettingsStore } from "../src/store/settings.ts";
import { ThemeDeliverService } from "../src/themes/deliver.ts";
import { ThemeService } from "../src/themes/service.ts";
import { UpdateService } from "../src/updates/service.ts";
import { writeStarter } from "./fixtures/starter.ts";

export const PORT = 47880;
export const ADMIN = `http://127.0.0.1:${PORT}`;
export const TOKEN = "test-token-abcdefghijklmnopqrstuvwxyz";
export const SESSION = "test-session-0123456789abcdefghijklmn";
export const COOKIE = `bj_session_${PORT}`;
export const SKILLS_DIR = path.resolve(import.meta.dirname, "../../../skills");

/** Where tests put "the Bukit that ships with the app" (plan 8.1): the directory BukitService reads. */
export const testBukitDir = (home: string) => path.join(home, "bundled-bukit");

/** Put `source` in `testBukitDir(home)` as the bundled Bukit; null removes it. */
export function installAppBukit(home: string, source: string | null): void {
  const dir = testBukitDir(home);
  if (!source) {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, "bukit"), { force: true });
  fs.symlinkSync(path.resolve(source), path.join(dir, "bukit"));
}

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
    /** Agent options; without a model, sending a message answers agent.no_model. */
    agent?: Partial<
      Pick<AgentServiceOptions, "resolveModel" | "setupRuntime" | "idleMs" | "rgReady" | "thinkingLevel">
    >;
    /** How long a connection test waits for the model. */
    modelTestTimeoutMs?: number;
    /** Replay buffer size of the event hub. */
    replayBytes?: number;
    eventStream?: EventStreamOptions;
    /** The git BukitJalil (and so Bukit) runs; the system git by default. */
    gitPath?: string;
    /** Notion API used by data source tests; null (the default) keeps the network off. */
    dataSourceFetch?: typeof fetch | null;
    /** Least time between Notion requests; 0 unless a test checks the queue. */
    notionGapMs?: number;
    /** GitHub API used by publish account tests; null (the default) keeps the network off. */
    publishFetch?: typeof fetch | null;
    /** Git status/install tests: Homebrew lookup, command runner and latest-release fetch. */
    gitBrew?: string | null;
    gitFetch?: typeof fetch | null;
    gitRunBrew?: GitServiceOptions["runBrew"];
    gitResolvePath?: () => string | null;
    gitCheck?: GitServiceOptions["check"];
    /** The app lock (plan 6.9); none by default, like `pnpm dev`. */
    security?: SecurityService;
  } = {},
) {
  const db = openDatabase(":memory:");
  const paths = ensureAppHome(overrides.appHome ?? fs.mkdtempSync(path.join(os.tmpdir(), "bj-app-")));
  const bukit =
    overrides.bukit ??
    new BukitService({
      dir: "/nonexistent-bukitjalil-bukit",
      tmpDir: os.tmpdir(),
    });
  const rg = overrides.rg ?? new RgService({ piBin: paths.piBin });
  const git = new GitRunner({
    gitPath: overrides.gitPath ?? resolveGitPath() ?? "/nonexistent/git",
    home: paths.home,
    emptyFile: paths.emptyGitConfig,
    hooksDir: paths.emptyHooks,
    ceilingDirs: [paths.home],
  });
  const gitStatus = new GitService({
    fetchImpl: overrides.gitFetch ?? null,
    brew: overrides.gitBrew ?? null,
    appHome: paths.home,
    runBrew: overrides.gitRunBrew,
    resolvePath: overrides.gitResolvePath ?? (() => git.opts.gitPath),
    check: overrides.gitCheck,
    applyPath: (path) => git.usePath(path),
  });
  const locks = new SiteLocks();
  const settings = new SettingsStore(db);
  const logger = overrides.logger ?? silentLogger;
  const vault = new FieldVault(db);
  const dataSources = new DataSourceService({
    db,
    vault,
    fetchImpl: overrides.dataSourceFetch ?? null,
    notionGapMs: overrides.notionGapMs ?? 0,
  });
  const publishAccounts = new PublishAccountService({ db, vault, fetchImpl: overrides.publishFetch ?? null });
  const repos = new ProjectRepos({ db, git, paths, bukit });
  const sites = new SiteService({
    db,
    git,
    paths,
    settings,
    bukit,
    locks,
    dataSources,
    // No real Bukit in unit tests: a copy of its `bukit new` output (plan 5.2).
    newSite: async (target, values) => writeStarter(target, values),
    userHome: overrides.userHome,
    repos,
    otherProjects: () => themes.list(),
  });
  const themes = new ThemeService({
    db,
    paths,
    userHome: overrides.userHome,
    settings,
    locks,
    repos,
    otherProjects: () => sites.list(),
    newSite: async (target, values) => writeStarter(target, values),
    themeDemo: path.join(import.meta.dirname, "..", "assets", "theme-demo"),
  });
  const projects = new ProjectService(sites, themes, repos);
  const previews = new PreviewPool(overrides.previewBase ?? 49500, new Set([PORT]), logger);
  const changes = new ChangeService({
    db,
    git,
    projects,
    locks,
    check: (project, cwd, commit) => aiBukit.checkForApply(project, cwd, commit),
    tmpDir: paths.tmp,
    logger,
  });
  const media = new MediaService({ git, sites, changes, locks, paths, logger });
  const deliver = new ThemeDeliverService({ git, paths, projects, changes, locks, logger });
  const aiBukit = new AiBukit({ git, paths, projects, bukit, changes });
  const customModels = new CustomModelStore({ db, vault });
  const builds = new BuildService({
    db,
    git,
    paths,
    projects,
    bukit,
    locks,
    previews,
    changes,
    notionToken: (project) => projects.notionToken(project),
    logger,
  });
  const agent = new AgentService({
    db,
    paths,
    projects,
    locks,
    changes,
    logger,
    credentials: new SecretCredentialStore({ db, vault }),
    resolveModel: () => undefined,
    rgReady: () => false,
    bukit: aiBukit,
    skillsDir: SKILLS_DIR,
    disabledSkills: () => settings.get().disabledSkills,
    content: new NotionContentAgent({ dataSources, tmp: paths.tmp }),
    ...overrides.agent,
  });
  const events = new EventHub(overrides.replayBytes);
  const updates = new UpdateService({
    currentVersion: "0.1.0-beta.4",
    dir: path.join(paths.home, "updates"),
    fetchImpl: null,
    logger,
    openInstaller: null,
  });
  const panels = new PanelService({
    git,
    projects,
    changeCommit: (id) => changes.openSnapshot(id),
    sourceCounts: (id, ref) => builds.sourceCounts(id, ref),
  });
  const deploys = new DeployService({ sites, panels, accounts: publishAccounts, git, bukit, locks, paths, logger, db });
  connectEvents(events, { agent, builds, changes, deploys, logger });
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
    themes,
    deliver,
    panels,
    media,
    builds,
    agent,
    gitStatus,
    changes,
    customModels,
    dataSources,
    publishAccounts,
    deploys,
    events,
    eventStream: overrides.eventStream,
    modelTestTimeoutMs: overrides.modelTestTimeoutMs,
    readIdentity: async () => ({ name: "Global Name", email: "global@example.com" }),
    userHome: overrides.userHome,
    version: "test",
    updates,
    logger,
    security: overrides.security,
  });
  return {
    app,
    db,
    loginToken,
    sites,
    themes,
    projects,
    repos,
    panels,
    media,
    deliver,
    paths,
    git,
    builds,
    previews,
    locks,
    changes,
    rg,
    bukit,
    agent,
    gitStatus,
    events,
    updates,
    customModels,
    dataSources,
    publishAccounts,
    deploys,
  };
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

/** Windows keeps no Unix permission bits (files report 0o666), so mode assertions only apply elsewhere. */
export function expectMode(file: string, expected: number): void {
  if (process.platform === "win32") return;
  expect(fs.statSync(file).mode & 0o777).toBe(expected);
}

/** An empty file for GIT_CONFIG_GLOBAL: Git for Windows rejects `os.devNull` (`\\.\nul`) there. */
let emptyGitConfig: string | undefined;
export function noGitConfig(): string {
  if (process.platform !== "win32") return os.devNull;
  if (!emptyGitConfig) {
    emptyGitConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bj-gitcfg-")), "empty");
    fs.writeFileSync(emptyGitConfig, "");
  }
  return emptyGitConfig;
}

/** The system git with a fixed, minimal environment, for test fixtures (never the code under test). */
export function rawGit(home: string, cwd: string, ...args: string[]): string {
  return execFileSync(resolveGitPath() as string, args, {
    cwd,
    env: { PATH: "/usr/bin:/bin", HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: noGitConfig() },
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
