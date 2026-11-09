import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type HealthResponse, SettingsPatch, sessionCookieName } from "@bukitjalil/shared";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { GitHealth } from "./git/version.ts";
import type { Logger } from "./log.ts";
import { apiError, apiGuard, hostCheck } from "./security/guard.ts";
import { adminCsp, adminHeaders, CSP_NONCE_PLACEHOLDER, newCspNonce } from "./security/headers.ts";
import type { LoginToken } from "./security/token.ts";
import { contentType, resolveStaticFile } from "./static-files.ts";
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
  version: string;
  logger: Logger;
}

type Env = { Variables: { cspNonce: string | undefined } };

export function createAdminApp(opts: AdminAppOptions) {
  const settings = new SettingsStore(opts.db);
  const cookieName = sessionCookieName(opts.port);
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    await next();
    for (const [k, v] of Object.entries(adminHeaders)) c.header(k, v);
    c.header("Content-Security-Policy", adminCsp(c.get("cspNonce") ?? null));
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
    if (new URL(c.req.url).pathname.startsWith("/api/")) return apiError(c, 500, "server.internal");
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

  const api = new Hono<Env>();
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
    return c.json(settings.update(patch.data));
  });

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
