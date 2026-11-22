import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_ADMIN_PORT, DEFAULT_PREVIEW_PORT_BASE } from "@bukitjalil/shared";
import { serve } from "@hono/node-server";
import { AiBukit } from "./agent/ai-bukit.ts";
import { NotionContentAgent } from "./agent/content-agent.ts";
import { CustomModelStore } from "./agent/custom-models.ts";
import { preparePiEnvironment } from "./agent/env.ts";
import { registerFakeModel } from "./agent/fake-model.ts";
import { settingsModel } from "./agent/models.ts";
import { RgService } from "./agent/rg.ts";
import { SecretCredentialStore } from "./agent/secret-credentials.ts";
import { AgentService } from "./agent/service.ts";
import { createAdminApp, createLockedApp } from "./app.ts";
import { BuildService } from "./builds/service.ts";
import { BukitService, removeOldAppCopies } from "./bukit/locate.ts";
import { ChangeService } from "./changes/service.ts";
import { DataSourceService } from "./data-sources/service.ts";
import { DeployService } from "./deploys/service.ts";
import { type DesktopChannel, desktopChannel, requestOpenInstaller } from "./desktop.ts";
import { connectEvents } from "./events/bridge.ts";
import { EventHub } from "./events/hub.ts";
import { readGlobalIdentity } from "./git/identity.ts";
import { appGitPath } from "./git/platform.ts";
import { GitRunner, resolveGitPath } from "./git/run.ts";
import { GitService } from "./git/service.ts";
import { checkGit } from "./git/version.ts";
import { acquireHomeLock, HomeInUseError } from "./lock.ts";
import { createLogger } from "./log.ts";
import { MediaService } from "./media/service.ts";
import { PanelService } from "./panels/service.ts";
import { ensureAppHome, readPackageVersion, resolveAppHome, resolveResources } from "./paths.ts";
import { PreviewPool } from "./preview/pool.ts";
import { ProjectRepos } from "./projects/repo.ts";
import { ProjectService } from "./projects/service.ts";
import { PublishAccountService } from "./publish/accounts.ts";
import { SecurityService } from "./security/pin.ts";
import { resetAppData } from "./security/reset.ts";
import { LoginToken, randomSecret } from "./security/token.ts";
import { FieldVault } from "./security/vault.ts";
import { SiteLocks } from "./sites/locks.ts";
import { NotionSnapshots } from "./sites/notion-snapshots.ts";
import { SiteService } from "./sites/service.ts";
import { bukitNewSite } from "./sites/template.ts";
import { type Db, openDatabase } from "./store/db.ts";
import { SettingsStore } from "./store/settings.ts";
import { ThemeDeliverService } from "./themes/deliver.ts";
import { ThemeService } from "./themes/service.ts";
import { UpdateService } from "./updates/service.ts";

// The desktop app passes app.getVersion(); development reads the root package.json so the footer and the
// update check see the same version as a release. Explicit paths avoid picking a parent package.json.
const versionFile = process.env.BUKITJALIL_RESOURCES
  ? path.join(process.env.BUKITJALIL_RESOURCES, "package.json")
  : path.resolve(import.meta.dirname, "../../../package.json");
const VERSION = process.env.BUKITJALIL_VERSION?.trim() || readPackageVersion(versionFile) || "0.0.0";

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
    reset: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.desktop) {
  desktop = desktopChannel();
  if (!desktop) fail("--desktop is only for the desktop app");
}
if (values.reset && !desktop) fail("--reset is only for the desktop app");

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
// A forgotten PIN (plan 6.9): the desktop app stopped the old server and started this one to delete the data,
// before anything opens the database. The emptied directory is set up again as on a first start.
if (values.reset) {
  resetAppData(paths);
  ensureAppHome(paths.home);
}
// Before anything can load Pi: it reads these when its modules load (plan 6.1).
preparePiEnvironment(paths.pi);
const logger = createLogger(paths.logs);

// git is resolved once; every later call uses this absolute path (plan 7.3).
const gitPath = resolveGitPath() ?? appGitPath(paths.home);

const offline = process.env.BUKITJALIL_OFFLINE === "1";

// Without a Developer ID macOS cannot install an update itself, so this only downloads the installer and
// hands it to the desktop app to open; Windows and Linux follow the same user-confirmed path.
const desktopForUpdates = desktop;
const updates = new UpdateService({
  currentVersion: VERSION,
  dir: path.join(paths.home, "updates"),
  fetchImpl: offline ? null : fetch,
  logger,
  openInstaller: desktopForUpdates ? (file) => requestOpenInstaller(desktopForUpdates, file) : null,
  platform: process.platform,
  arch: process.arch,
  // AppImage sets APPIMAGE; a deb install does not. The update downloads the same format the user runs.
  linuxPackage: process.env.APPIMAGE ? "appimage" : "deb",
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
const previews = new PreviewPool(previewBase, new Set([port]), logger);
const rg = new RgService({ piBin: paths.piBin });
// Every session gives the AI these skills and the gate reads them, so a missing directory stops startup.
const skillsDir = resources.skills;
if (!fs.existsSync(path.join(skillsDir, "bukitjalil", "site-editing", "SKILL.md"))) {
  fail(`BukitJalil's AI skills are missing: ${skillsDir}`);
}
// New theme projects copy it (theme development design 3.4).
if (!fs.existsSync(path.join(resources.themeDemo, "content", "posts"))) {
  fail(`BukitJalil's theme sample content is missing: ${resources.themeDemo}`);
}
const webDist = resources.web;
const loginToken = new LoginToken();
const dev = values["dev-origin"] !== undefined;
/** Login, the UI and health: the same before and after the database opens (plan 6.9). */
const base = {
  port,
  allowedOrigin,
  loginToken,
  sessionValue: randomSecret(),
  webDist: !dev && fs.existsSync(path.join(webDist, "index.html")) ? webDist : null,
  checkGit: () => checkGit(git.opts.gitPath),
  version: VERSION,
  logger,
};

/** The services that keep their data in app.db, started once it is open (plan 6.9). */
interface Runtime {
  app: ReturnType<typeof createAdminApp>;
  events: EventHub;
  agent: AgentService;
  builds: BuildService;
  deploys: DeployService;
  locks: SiteLocks;
  db: Db;
}
let runtime: Runtime | null = null;
// The desktop app's database is encrypted with the PIN and opens when it is set up or entered; `pnpm dev`
// and tests open a plain one at once and are never locked.
const security = new SecurityService({
  file: desktop ? paths.db : null,
  logger,
  onOpen: (db) => {
    try {
      runtime = startServices(db);
    } catch (err) {
      // Half started is worse than stopped: the desktop app shows that the server stopped and offers a restart.
      logger.log("error", "server.start_failed", { error: String(err) });
      fail(`Cannot start the services: ${(err as Error).message}`);
    }
  },
  onLock: () => runtime?.events.closeAll(),
  ...(desktop ? { onReset: () => desktop?.send({ type: "reset" }) } : {}),
});
// Idle locking (plan 6.9), off unless the user turned it on.
setInterval(() => security.checkIdle(), 30_000).unref();

function startServices(db: Db): Runtime {
  const settingsStore = new SettingsStore(db);

  // Tokens and model keys (plan 6.9): in the database, encrypted again with its field key.
  const vault = new FieldVault(db);
  const dataSources = new DataSourceService({ db, vault, fetchImpl: offline ? null : fetch });
  const publishAccounts = new PublishAccountService({ db, vault, fetchImpl: offline ? null : fetch });
  const locks = new SiteLocks();
  // Sites and theme projects share the repository work, and neither may overlap the other (theme design 3).
  const repos = new ProjectRepos({ db, git, paths, bukit });
  const sites = new SiteService({
    db,
    git,
    paths,
    settings: settingsStore,
    bukit,
    locks,
    dataSources,
    newSite: bukitNewSite(bukit, { git, home: paths.home, tmpDir: paths.bukitTmp }),
    notionSnapshots: new NotionSnapshots({ db, root: paths.notionSnapshots, logger }),
    repos,
    otherProjects: () => themes.list(),
  });
  const themes = new ThemeService({
    db,
    paths,
    settings: settingsStore,
    locks,
    repos,
    otherProjects: () => sites.list(),
    newSite: bukitNewSite(bukit, { git, home: paths.home, tmpDir: paths.bukitTmp }),
    themeDemo: resources.themeDemo,
  });
  const projects = new ProjectService(sites, themes, repos);

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
  const customModels = new CustomModelStore({ db, vault });
  const credentials = new SecretCredentialStore({ db, vault });

  const agent = new AgentService({
    db,
    paths,
    projects,
    locks,
    changes,
    logger,
    // The model chosen in the settings (plan 6.5), looked up again before every run.
    credentials,
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
    content: new NotionContentAgent({ dataSources, tmp: paths.tmp }),
  });
  // A removed data source took its content conversations with it (ON DELETE CASCADE): stop them too.
  dataSources.onRemoved((id) => void agent.closeContentSource(id));
  const panels = new PanelService({
    git,
    projects,
    changeCommit: (id) => changes.openSnapshot(id),
    sourceCounts: (id, ref) => builds.sourceCounts(id, ref),
  });
  const deploys = new DeployService({ sites, panels, accounts: publishAccounts, git, bukit, locks, paths, logger, db });
  const events = new EventHub();
  connectEvents(events, { agent, builds, changes, deploys, logger });
  const app = createAdminApp({
    ...base,
    db,
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
    // Tests set BUKITJALIL_OFFLINE=1; the Pi row then shows only the bundled version.
    piFetch: offline ? null : fetch,
    events,
    readIdentity: () => (gitPath ? readGlobalIdentity(gitPath) : Promise.resolve({ name: null, email: null })),
    updates,
    security,
  });
  return { app, events, agent, builds, deploys, locks, db };
}

if (!desktop) runtime = startServices(openDatabase(paths.db));
const lockedApp = createLockedApp({ ...base, security });

const server = serve({
  fetch: (request, env) => (runtime?.app ?? lockedApp).fetch(request, env),
  port,
  hostname: "127.0.0.1",
});
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
      else if (message.type === "shutdown") void shutdown();
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
    // Before the PIN opens the database there are no services to stop.
    if (runtime) {
      const { events, agent, builds, deploys, locks } = runtime;
      events.closeAll();
      // All at once: each may wait for a Bukit process to stop. The services refuse new work first, then the
      // locks refuse every other site operation, and operations already running get to finish.
      const stopping = Promise.all([agent.shutdown(), builds.shutdown(), deploys.shutdown()]);
      locks.close();
      await stopping;
      if (!(await locks.idle(SHUTDOWN_WAIT_MS))) logger.log("warn", "server.shutdown_timeout", {});
    }
    await previews.closeAll();
    runtime?.db.close();
  } catch (err) {
    logger.log("error", "server.shutdown_failed", { error: String(err) });
  }
  releaseLock();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown(true));
process.on("SIGTERM", () => void shutdown(true));
