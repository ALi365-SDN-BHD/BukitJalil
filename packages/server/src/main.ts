import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_ADMIN_PORT, DEFAULT_PREVIEW_PORT_BASE } from "@bukitjalil/shared";
import { serve } from "@hono/node-server";
import { createAdminApp } from "./app.ts";
import { checkGit } from "./git/version.ts";
import { createLogger } from "./log.ts";
import { ensureAppHome, resolveAppHome } from "./paths.ts";
import { PreviewPool } from "./preview/pool.ts";
import { randomSecret } from "./security/token.ts";
import { openDatabase } from "./store/db.ts";

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
const logger = createLogger(paths.logs);
const db = openDatabase(paths.db);

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const webDist = path.join(repoRoot, "packages/web/dist");
const token = randomSecret();

const app = createAdminApp({
  port,
  allowedOrigin,
  token,
  sessionValue: randomSecret(),
  db,
  webDist: values["dev-origin"] === undefined && fs.existsSync(path.join(webDist, "index.html")) ? webDist : null,
  checkGit: () => checkGit(),
  version: VERSION,
});

const previews = new PreviewPool(previewBase, new Set([port]), logger);

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") fail(`Port ${port} is in use. Start with --port <another port>.`);
  fail(`Cannot start server: ${err.message}`);
});
server.on("listening", () => {
  const url = `${openOrigin}/?token=${token}`;
  logger.log("info", "server.listening", { port, previewBase, dev: values["dev-origin"] !== undefined });
  process.stdout.write(`\nBukitJalil is running. Open:\n  ${url}\n\n`);
  if (!values["no-open"]) openBrowser(url);
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
  await previews.closeAll();
  server.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
