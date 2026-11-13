import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_ADMIN_PORT, DEFAULT_PREVIEW_PORT_BASE } from "@bukitjalil/shared";
import { serve } from "@hono/node-server";
import { AiBukit } from "./agent/ai-bukit.ts";
import { CustomModelStore } from "./agent/custom-models.ts";
import { preparePiEnvironment } from "./agent/env.ts";
import { registerFakeModel } from "./agent/fake-model.ts";
import { settingsModel } from "./agent/models.ts";
import { RgService } from "./agent/rg.ts";
import { AgentService } from "./agent/service.ts";
import { createAdminApp } from "./app.ts";
import { BuildService } from "./builds/service.ts";
import { BukitService, removeOldAppCopies } from "./bukit/locate.ts";
import { ChangeService } from "./changes/service.ts";
import { DataSourceService } from "./data-sources/service.ts";
import { DeployService } from "./deploys/service.ts";
import { type DesktopChannel, desktopChannel } from "./desktop.ts";
import { connectEvents } from "./events/bridge.ts";
import { EventHub } from "./events/hub.ts";
import { readGlobalIdentity } from "./git/identity.ts";
import { appGitPath } from "./git/platform.ts";
import { GitRunner, resolveGitPath } from "./git/run.ts";
import { GitService } from "./git/service.ts";
import { checkGit } from "./git/version.ts";
import { acquireHomeLock, HomeInUseError } from "./lock.ts";
import { createLogger } from "./log.ts";
import { PanelService } from "./panels/service.ts";
import { ensureAppHome, resolveAppHome, resolveResources } from "./paths.ts";
import { PreviewPool } from "./preview/pool.ts";
import { PublishAccountService } from "./publish/accounts.ts";
import { LoginToken, randomSecret } from "./security/token.ts";
import { SiteLocks } from "./sites/locks.ts";
import { SiteService } from "./sites/service.ts";
import { openDatabase } from "./store/db.ts";
import { SettingsStore } from "./store/settings.ts";

const VERSION = process.env.BUKITJALIL_VERSION?.trim() || "0.0.0";

/** Set with --desktop: the desktop app's main process started this server (plan M7). */
let desktop: DesktopChannel | null = null;

function fail(message: string, code: "port_in_use" | "home_in_use" | "start_failed" = "start_failed"): never {
  process.stderr.write(`${message}\n`);
  desktop?.send({ type: "error", code, message });
  process.exit(1);
}

function parsePort(value: string | undefined, fallback: number, flag: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) fail(`${flag} must be an integer between 1024 and 65535`);
  return n;
}

// pnpm forwards the "--" of `pnpm start -- --port 48000`; drop it so both spellings work.
const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();

const { values } = parseArgs({
  args: argv,
  options: {
    port: { type: "string" },
    "preview-port-base": { type: "string" },
    "dev-origin": { type: "string" },
    "no-open": { type: "boolean", default: false },
    desktop: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.desktop) {
  desktop = desktopChannel();
  if (!desktop) fail("--desktop is only for the desktop app");
}

const port = parsePort(values.port, DEFAULT_ADMIN_PORT, "--port");
const previewBase = parsePort(values["preview-port-base"], DEFAULT_PREVIEW_PORT_BASE, "--preview-port-base");
const adminOrigin = `http://127.0.0.1:${port}`;

// --dev-origin is only for `pnpm dev` (plan 3.3); scripts/dev.mjs sets BUKITJALIL_DEV=1.
let allowedOrigin = adminOrigin;
let openOrigin = adminOrigin;
if (values["dev-origin"] !== undefined) {
  if (process.env.BUKITJALIL_DEV !== "1") fail("--dev-origin is only accepted by `pnpm dev`");
  if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(values["dev-origin"]))
    fail("--dev-origin must be http://127.0.0.1:<port>");
  allowedOrigin = values["dev-origin"];
  openOrigin = values["dev-origin"];
}

const paths = ensureAppHome(resolveAppHome());
// Before the database opens: one server per data directory (plan M7).
let releaseLock: () => void;
try {
  releaseLock = acquireHomeLock(paths.lock);
} catch (err) {
  if (err instanceof HomeInUseError) fail(err.message, "home_in_use");
  throw err;
}
process.on("exit", () => releaseLock());
// Before anything can load Pi: it reads these when its modules load (plan 6.1).
preparePiEnvironment(paths.pi);
const logger = createLogger(paths.logs);
const db = openDatabase(paths.db);

// git is resolved once; every later call uses this absolute path (plan 7.3).
const gitPath = resolveGitPath() ?? appGitPath(paths.home);

const settingsStore = new SettingsStore(db);
const offline = process.env.BUKITJALIL_OFFLINE === "1";
const dataSources = new DataSourceService({
  db,
  tokenFile: paths.dataSourceTokens,
  fetchImpl: offline ? null : fetch,
});
const publishAccounts = new PublishAccountService({
  db,
  tokenFile: paths.publishAccountTokens,
  fetchImpl: offline ? null : fetch,
});
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const resources = resolveResources(repoRoot);
// Bukit ships with the app (plan 8.1); copies earlier versions installed in ~/.bukitjalil/bin are removed.
removeOldAppCopies(paths.home);
const bukit = new BukitService({ dir: resources.bukit, tmpDir: paths.bukitTmp });
// Without git, site operations fail when they run git; /api/health tells the user git is missing.
const git = new GitRunner({
  gitPath: gitPath ?? "/nonexistent/git",
  home: paths.home,
  emptyFile: paths.emptyGitConfig,
  hooksDir: paths.emptyHooks,
  ceilingDirs: [paths.home],
});
const gitStatus = new GitService({
  fetchImpl: offline ? null : fetch,
  appHome: paths.home,
  applyPath: (path) => git.usePath(path),
});
const locks = new SiteLocks();
const sites = new SiteService({
  db,
  git,
  paths,
  settings: settingsStore,
  bukit,
  locks,
  dataSources,
  templateDir: resources.starter,
});

const previews = new PreviewPool(previewBase, new Set([port]), logger);
const rg = new RgService({ piBin: paths.piBin });
// Every session gives the AI these skills and the gate reads them, so a missing directory stops startup.
const skillsDir = resources.skills;
if (!fs.existsSync(path.join(skillsDir, "bukitjalil", "site-editing", "SKILL.md"))) {
  fail(`BukitJalil's AI skills are missing: ${skillsDir}`);
}
const changes = new ChangeService({
  db,
  git,
  sites,
  locks,
  check: (siteId, cwd, commit) => aiBukit.checkForApply(siteId, cwd, commit),
  tmpDir: paths.tmp,
  logger,
});
const aiBukit = new AiBukit({ git, paths, sites, bukit, changes });
const builds = new BuildService({
  db,
  git,
  paths,
  sites,
  bukit,
  locks,
  previews,
  changes,
  notionToken: (siteId) => sites.notionToken(siteId),
  logger,
});
const customModels = new CustomModelStore(path.join(paths.pi, "custom-models.json"));
// A killed write can leave a temp file and then a token entry with no account. Remove both before
// anything reads the stores.
const staleTemps =
  publishAccounts.cleanupTempFiles() + dataSources.cleanupTempFiles() + customModels.cleanupTempFiles();
if (staleTemps > 0) logger.log("warn", "storage.temps_removed", { count: staleTemps });
try {
  const accounts = publishAccounts.pruneUnknownTokens();
  const sources = dataSources.pruneUnknownTokens();
  if (accounts + sources > 0) logger.log("warn", "tokens.orphans_removed", { accounts, sources });
} catch (err) {
  logger.log("warn", "tokens.orphans_cleanup_failed", { error: String(err) });
}
const agent = new AgentService({
  db,
  paths,
  sites,
  locks,
  changes,
  logger,
  // The model chosen in the settings (plan 6.5), looked up again before every run.
  resolveModel: settingsModel(settingsStore),
  thinkingLevel: () => settingsStore.get().thinkingLevel,
  // A scripted model for end-to-end tests (agent/fake-model.ts); never set in normal use.
  setupRuntime: (runtime, pi) => {
    if (process.env.BUKITJALIL_FAKE_MODEL === "1") registerFakeModel(runtime, pi);
    customModels.registerAll(runtime);
  },
  rgReady: () => rg.ready(),
  bukit: aiBukit,
  skillsDir,
  disabledSkills: () => settingsStore.get().disabledSkills,
});
const panels = new PanelService({ git, sites, changeCommit: (id) => changes.openSnapshot(id) });
const deploys = new DeployService({ sites, panels, accounts: publishAccounts, git, bukit, locks, paths, logger, db });
const events = new EventHub();
connectEvents(events, { agent, builds, changes, deploys, logger });
const webDist = resources.web;
const loginToken = new LoginToken();
const dev = values["dev-origin"] !== undefined;

const app = createAdminApp({
  port,
  allowedOrigin,
  loginToken,
  sessionValue: randomSecret(),
  db,
  webDist: !dev && fs.existsSync(path.join(webDist, "index.html")) ? webDist : null,
  checkGit: () => checkGit(git.opts.gitPath),
  bukit,
  rg,
  sites,
  panels,
  builds,
  agent,
  gitStatus,
  changes,
  customModels,
  dataSources,
  publishAccounts,
  deploys,
  // Tests set BUKITJALIL_OFFLINE=1; the Pi row then shows only the bundled version.
  piFetch: offline ? null : fetch,
  events,
  readIdentity: () => (gitPath ? readGlobalIdentity(gitPath) : Promise.resolve({ name: null, email: null })),
  version: VERSION,
  logger,
});

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
server.on("error", (err: NodeJS.ErrnoException) => {
  // EACCES: Windows reserves port ranges (Hyper-V, WSL, Docker) that no program may listen on. Either way the
  // port cannot be used, and the desktop app moves on to the next one.
  if (err.code === "EADDRINUSE" || err.code === "EACCES")
    fail(`Port ${port} is in use or reserved. Start with --port <another port>.`, "port_in_use");
  fail(`Cannot start server: ${err.message}`);
});

/** Print a fresh one-time login link (plan 11); the previous unused link stops working. */
function printLoginUrl(): string {
  const url = `${openOrigin}/?token=${loginToken.issue()}`;
  process.stdout.write(`\nBukitJalil login link (works once):\n  ${url}\n`);
  // In dev, tsx watch takes Enter to restart the server, which prints a new link as well.
  process.stdout.write(dev ? "Press Enter to restart and get a new link.\n\n" : "Press Enter for a new link.\n\n");
  return url;
}

server.on("listening", () => {
  logger.log("info", "server.listening", { port, previewBase, dev, desktop: !!desktop });
  if (desktop) {
    // The desktop window asks for a login link whenever it needs one; nothing is printed or opened.
    const channel = desktop;
    channel.onMessage((message) => {
      if (message.type === "login") channel.send({ type: "login", url: `${openOrigin}/?token=${loginToken.issue()}` });
      else void shutdown();
    });
    channel.onClose(() => void shutdown());
    channel.send({ type: "ready", port });
    return;
  }
  const url = printLoginUrl();
  if (!values["no-open"]) openBrowser(url);
  if (!dev) {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      if (chunk.includes("\n")) printLoginUrl();
    });
    process.stdin.on("error", () => {});
  }
});

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

/** Longest wait for site operations (apply, import, removal…) to finish during shutdown. */
const SHUTDOWN_WAIT_MS = 15_000;

/**
 * A signal this long after shutdown began means "leave now". Sooner ones are the same request delivered
 * twice: `pnpm dev` (tsx watch) passes the terminal's Ctrl-C on to a process that got it already.
 */
const FORCE_EXIT_AFTER_MS = 1_000;

let closingSince: number | null = null;
async function shutdown(signal = false) {
  if (closingSince !== null) {
    // Another Ctrl-C, or the desktop app giving up, while operations are still finishing.
    if (signal && Date.now() - closingSince >= FORCE_EXIT_AFTER_MS) {
      releaseLock();
      process.exit(1);
    }
    return;
  }
  closingSince = Date.now();
  try {
    server.close();
    events.closeAll();
    // All at once: each may wait for a Bukit process to stop. The services refuse new work first, then the
    // locks refuse every other site operation, and operations already running get to finish.
    const stopping = Promise.all([agent.shutdown(), builds.shutdown(), deploys.shutdown()]);
    locks.close();
    await stopping;
    if (!(await locks.idle(SHUTDOWN_WAIT_MS))) logger.log("warn", "server.shutdown_timeout", {});
    await previews.closeAll();
    db.close();
  } catch (err) {
    logger.log("error", "server.shutdown_failed", { error: String(err) });
  }
  releaseLock();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown(true));
process.on("SIGTERM", () => void shutdown(true));
