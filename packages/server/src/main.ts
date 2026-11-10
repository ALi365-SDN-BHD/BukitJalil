import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_ADMIN_PORT, DEFAULT_PREVIEW_PORT_BASE } from "@bukitjalil/shared";
import { serve } from "@hono/node-server";
import { AiBukit } from "./agent/ai-bukit.ts";
import { preparePiEnvironment } from "./agent/env.ts";
import { registerFakeModel } from "./agent/fake-model.ts";
import { settingsModel } from "./agent/models.ts";
import { RgService } from "./agent/rg.ts";
import { AgentService } from "./agent/service.ts";
import { createAdminApp } from "./app.ts";
import { BuildService } from "./builds/service.ts";
import { BukitService } from "./bukit/locate.ts";
import { ChangeService } from "./changes/service.ts";
import { connectEvents } from "./events/bridge.ts";
import { EventHub } from "./events/hub.ts";
import { readGlobalIdentity } from "./git/identity.ts";
import { GitRunner, resolveGitPath } from "./git/run.ts";
import { checkGit } from "./git/version.ts";
import { createLogger } from "./log.ts";
import { PanelService } from "./panels/service.ts";
import { ensureAppHome, resolveAppHome } from "./paths.ts";
import { PreviewPool } from "./preview/pool.ts";
import { LoginToken, randomSecret } from "./security/token.ts";
import { SiteLocks } from "./sites/locks.ts";
import { SiteService } from "./sites/service.ts";
import { openDatabase } from "./store/db.ts";
import { SettingsStore } from "./store/settings.ts";

const VERSION = "0.0.0";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parsePort(value: string | undefined, fallback: number, flag: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) fail(`${flag} must be an integer between 1024 and 65535`);
  return n;
}

const { values } = parseArgs({
  options: {
    port: { type: "string" },
    "preview-port-base": { type: "string" },
    "dev-origin": { type: "string" },
    "no-open": { type: "boolean", default: false },
  },
  strict: true,
});

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
// Before anything can load Pi: it reads these when its modules load (plan 6.1).
preparePiEnvironment(paths.pi);
const logger = createLogger(paths.logs);
const db = openDatabase(paths.db);

// git is resolved once; every later call uses this absolute path (plan 7.3).
const gitPath = resolveGitPath();

const settingsStore = new SettingsStore(db);
const bukit = new BukitService({
  home: paths.home,
  tmpDir: paths.bukitTmp,
  customPath: () => settingsStore.get().bukitPath,
});

const repoRoot = path.resolve(import.meta.dirname, "../../..");
// Without git, site operations fail when they run git; /api/health tells the user git is missing.
const git = new GitRunner({
  gitPath: gitPath ?? "/nonexistent/git",
  home: paths.home,
  emptyFile: paths.emptyGitConfig,
  hooksDir: paths.emptyHooks,
  ceilingDirs: [paths.home],
});
const locks = new SiteLocks();
const sites = new SiteService({
  db,
  git,
  paths,
  settings: settingsStore,
  bukit,
  locks,
  templateDir: path.join(repoRoot, "templates", "starter"),
});
const panels = new PanelService({ git, sites });
const previews = new PreviewPool(previewBase, new Set([port]), logger);
const builds = new BuildService({ db, git, paths, sites, bukit, locks, previews, logger });
const rg = new RgService({ piBin: paths.piBin });
// Every session gives the AI these skills and the gate reads them, so a missing directory stops startup.
const skillsDir = path.join(repoRoot, "skills");
if (!fs.existsSync(path.join(skillsDir, "bukitjalil", "site-editing", "SKILL.md"))) {
  fail(`BukitJalil's AI skills are missing: ${skillsDir}`);
}
const changes = new ChangeService({ db, git, sites, logger });
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
  setupRuntime: process.env.BUKITJALIL_FAKE_MODEL === "1" ? registerFakeModel : undefined,
  rgReady: () => rg.ready(),
  bukit: new AiBukit({ git, paths, sites, bukit, changes }),
  skillsDir,
});
const events = new EventHub();
connectEvents(events, agent, builds);
const webDist = path.join(repoRoot, "packages/web/dist");
const loginToken = new LoginToken();
const dev = values["dev-origin"] !== undefined;

const app = createAdminApp({
  port,
  allowedOrigin,
  loginToken,
  sessionValue: randomSecret(),
  db,
  webDist: !dev && fs.existsSync(path.join(webDist, "index.html")) ? webDist : null,
  checkGit: () =>
    gitPath ? checkGit(gitPath) : Promise.resolve({ ok: false, version: null, problem: "missing" as const }),
  bukit,
  rg,
  sites,
  panels,
  builds,
  agent,
  events,
  readIdentity: () => (gitPath ? readGlobalIdentity(gitPath) : Promise.resolve({ name: null, email: null })),
  version: VERSION,
  logger,
});

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") fail(`Port ${port} is in use. Start with --port <another port>.`);
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
  logger.log("info", "server.listening", { port, previewBase, dev });
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

async function shutdown() {
  events.closeAll();
  await agent.shutdown();
  await builds.shutdown();
  await previews.closeAll();
  server.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
