import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  type BukitResponse,
  type HealthResponse,
  type RgResponse,
  SettingsPatch,
  sessionCookieName,
} from "@bukitjalil/shared";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { ModelService } from "./agent/models.ts";
import type { RgService } from "./agent/rg.ts";
import type { AgentService } from "./agent/service.ts";
import { buildRoutes } from "./api/builds.ts";
import { changeRoutes } from "./api/changes.ts";
import { type EventStreamOptions, eventRoutes } from "./api/events.ts";
import { modelRoutes } from "./api/models.ts";
import { panelRoutes } from "./api/panels.ts";
import { secretRoutes } from "./api/secrets.ts";
import { sessionRoutes } from "./api/sessions.ts";
import { siteRoutes } from "./api/sites.ts";
import type { BuildService } from "./builds/service.ts";
import type { BukitService } from "./bukit/locate.ts";
import type { ChangeService } from "./changes/service.ts";
import type { EventHub } from "./events/hub.ts";
import type { GitIdentity } from "./git/identity.ts";
import type { GitHealth } from "./git/version.ts";
import type { Logger } from "./log.ts";
import type { PanelService } from "./panels/service.ts";
import { apiError, apiGuard, hostCheck } from "./security/guard.ts";
import { adminCsp, adminHeaders, CSP_NONCE_PLACEHOLDER, newCspNonce } from "./security/headers.ts";
import type { LoginToken } from "./security/token.ts";
import type { SecretStore } from "./settings/secrets.ts";
import type { SiteService } from "./sites/service.ts";
import { contentType, resolveStaticFile } from "./static-files.ts";
import { storageErrorCode } from "./storage-errors.ts";
import { SettingsStore } from "./store/settings.ts";

export interface AdminAppOptions {
  port: number;
  /** The only Origin accepted on non-GET requests: the admin URL, or the Vite URL in dev (plan 3.3). */
  allowedOrigin: string;
  /** One-time token from the printed URL. */
  loginToken: LoginToken;
  /** Value of the session cookie handed out after a correct token. */
  sessionValue: string;
  db: DatabaseSync;
  /** Built web UI to serve; null in dev, where Vite serves the UI. */
  webDist: string | null;
  checkGit: () => Promise<GitHealth>;
  bukit: BukitService;
  rg: RgService;
  sites: SiteService;
  panels: PanelService;
  builds: BuildService;
  agent: AgentService;
  changes: ChangeService;
  secrets: SecretStore;
  /** How long a connection test waits for the model. */
  modelTestTimeoutMs?: number;
  events: EventHub;
  /** Ping interval and queue limit of the event stream (tests). */
  eventStream?: EventStreamOptions;
  readIdentity: () => Promise<GitIdentity>;
  /** Overrides the home directory used by the directory picker (tests). */
  userHome?: string;
  version: string;
  logger: Logger;
}

export type AppEnv = {
  /** cspSandbox: a route serving site content (images, downloads) adds `sandbox` to the CSP (plan 9.1). */
  Variables: { cspNonce: string | undefined; cspSandbox: boolean | undefined };
};

export function createAdminApp(opts: AdminAppOptions) {
  const settings = new SettingsStore(opts.db);
  const cookieName = sessionCookieName(opts.port);
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    await next();
    for (const [k, v] of Object.entries(adminHeaders)) c.header(k, v);
    const sandbox = c.get("cspSandbox") === true;
    c.header("Content-Security-Policy", `${adminCsp(c.get("cspNonce") ?? null)}${sandbox ? "; sandbox" : ""}`);
  });
  app.use("*", hostCheck([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]));

  // Errors never leak details: /api answers with a code (plan 10.1), the log gets the stack (plan 13).
  app.onError((err, c) => {
    opts.logger.log("error", "request.failed", {
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      error: err.message,
      stack: err.stack,
    });
    if (new URL(c.req.url).pathname.startsWith("/api/")) {
      // A full or read-only disk is something the user can fix, so it gets its own message.
      const storage = storageErrorCode(err);
      if (storage) return apiError(c, storage === "fs.disk_full" ? 507 : 500, storage);
      return apiError(c, 500, "server.internal");
    }
    return c.body(null, 500);
  });

  // The session cookie is bound to the host 127.0.0.1, so pages opened via localhost are sent there.
  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    if (c.req.header("host") === `localhost:${opts.port}` && !url.pathname.startsWith("/api/")) {
      return c.redirect(`http://127.0.0.1:${opts.port}${url.pathname}${url.search}`, 307);
    }
    await next();
  });

  // Token login (plan 11): a correct, unused token sets the cookie. Either way the browser goes to a URL
  // without the token; without a session the UI explains how to get a new link (in the user's language).
  app.get("/", async (c, next) => {
    const token = c.req.query("token");
    if (token === undefined) return next();
    if (opts.loginToken.consume(token)) {
      setCookie(c, cookieName, opts.sessionValue, { httpOnly: true, sameSite: "Strict", path: "/api" });
      opts.logger.log("info", "auth.login", {});
    } else {
      opts.logger.log("warn", "auth.bad_token", {});
    }
    return c.redirect("/", 303);
  });

  const api = new Hono<AppEnv>();
  api.use("*", apiGuard({ allowedOrigin: opts.allowedOrigin, cookieName, sessionValue: opts.sessionValue }));

  api.get("/health", async (c) => {
    const git = await opts.checkGit();
    const body: HealthResponse = {
      ok: git.ok,
      version: opts.version,
      git,
      bukit: { ok: false, detail: "not_checked_yet" },
      pi: { ok: false, detail: "not_checked_yet" },
    };
    return c.json(body);
  });

  api.get("/settings", (c) => c.json(settings.get()));
  api.put("/settings", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, "request.invalid_body");
    }
    const patch = SettingsPatch.safeParse(body);
    if (!patch.success) return apiError(c, 400, "request.invalid_body");
    const updated = settings.update(patch.data);
    if (patch.data.bukitPath !== undefined) opts.bukit.invalidate();
    return c.json(updated);
  });

  api.get("/bukit", async (c) => {
    const body: BukitResponse = { status: await opts.bukit.status(), install: opts.bukit.installer.progress };
    return c.json(body);
  });
  // Install Bukit 2.0.12 (plan 8.1) after the user confirmed in the UI. Progress is polled from GET /bukit.
  api.post("/bukit/install", async (c) => {
    if (!(await opts.bukit.status()).installable) return apiError(c, 400, "bukit.unsupported_platform");
    if (!opts.bukit.install()) return apiError(c, 409, "bukit.install_running");
    return c.json({ install: opts.bukit.installer.progress }, 202);
  });

  // ripgrep for the AI's grep tool (plan 6.3): pinned version, checked by SHA-256, installed on request.
  api.get("/rg", (c) => {
    const body: RgResponse = { status: opts.rg.status(), install: opts.rg.installer.progress };
    return c.json(body);
  });
  api.post("/rg/install", (c) => {
    if (!opts.rg.status().installable) return apiError(c, 400, "rg.unsupported_platform");
    if (!opts.rg.installer.start()) return apiError(c, 409, "rg.install_running");
    return c.json({ install: opts.rg.installer.progress }, 202);
  });

  siteRoutes(api, { sites: opts.sites, builds: opts.builds, readIdentity: opts.readIdentity, userHome: opts.userHome });
  panelRoutes(api, opts.panels);
  buildRoutes(api, opts.builds);
  secretRoutes(api, opts.secrets);
  sessionRoutes(api, opts.agent);
  changeRoutes(api, { changes: opts.changes, agent: opts.agent, builds: opts.builds, logger: opts.logger });
  modelRoutes(
    api,
    new ModelService({
      runtime: () => opts.agent.models(),
      pi: () => opts.agent.piModules(),
      settings,
      piDir: opts.agent.piDir,
      testTimeoutMs: opts.modelTestTimeoutMs,
    }),
  );
  eventRoutes(api, opts.events, opts.eventStream);

  api.all("*", (c) => apiError(c, 404, "request.not_found"));
  app.route("/api", api);

  // Built UI. Unknown app routes fall back to index.html; missing files (assets, favicon, ...) are 404,
  // so a stale tab asking for an old hashed chunk never gets HTML cached as that chunk.
  app.get("*", (c) => {
    if (!opts.webDist) return apiError(c, 404, "request.not_found"); // dev: Vite serves the UI
    const pathname = new URL(c.req.url).pathname;
    let resolved = resolveStaticFile(opts.webDist, pathname);
    const appRoute = !pathname.startsWith("/assets/") && path.posix.extname(pathname) === "";
    if (!resolved.ok && resolved.status === 404 && appRoute) {
      resolved = resolveStaticFile(opts.webDist, "/index.html");
    }
    if (!resolved.ok) return c.body(null, resolved.status);

    if (resolved.file.endsWith(".html")) {
      const nonce = newCspNonce();
      c.set("cspNonce", nonce);
      const html = fs.readFileSync(resolved.file, "utf8").replaceAll(CSP_NONCE_PLACEHOLDER, nonce);
      return c.body(html, 200, { "Content-Type": contentType(resolved.file), "Cache-Control": "no-store" });
    }
    // Only Vite's content-hashed files under /assets/ are safe to cache forever.
    return c.body(fs.readFileSync(resolved.file), 200, {
      "Content-Type": contentType(resolved.file),
      "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store",
    });
  });

  return app;
}
