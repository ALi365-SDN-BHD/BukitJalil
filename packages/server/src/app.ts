import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { type HealthResponse, SESSION_COOKIE, SettingsPatch } from "@bukitjalil/shared";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { GitHealth } from "./git/version.ts";
import { apiError, apiGuard, hostCheck } from "./security/guard.ts";
import { adminHeaders } from "./security/headers.ts";
import { safeEqual } from "./security/token.ts";
import { contentType, resolveStaticFile } from "./static-files.ts";
import { SettingsStore } from "./store/settings.ts";

export interface AdminAppOptions {
  port: number;
  /** The only Origin accepted on non-GET requests: the admin URL, or the Vite URL in dev (plan 3.3). */
  allowedOrigin: string;
  /** One-time-per-process token from the printed URL. */
  token: string;
  /** Value of the session cookie handed out after a correct token. */
  sessionValue: string;
  db: DatabaseSync;
  /** Built web UI to serve; null in dev, where Vite serves the UI. */
  webDist: string | null;
  checkGit: () => Promise<GitHealth>;
  version: string;
}

export function createAdminApp(opts: AdminAppOptions) {
  const settings = new SettingsStore(opts.db);
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    for (const [k, v] of Object.entries(adminHeaders)) c.header(k, v);
  });
  app.use("*", hostCheck([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]));

  // The session cookie is bound to the host 127.0.0.1, so pages opened via localhost are sent there.
  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    if (c.req.header("host") === `localhost:${opts.port}` && !url.pathname.startsWith("/api/")) {
      return c.redirect(`http://127.0.0.1:${opts.port}${url.pathname}${url.search}`, 307);
    }
    await next();
  });

  // Token login (plan 11): check the token, set the cookie, redirect to a URL without it.
  app.get("/", async (c, next) => {
    const token = c.req.query("token");
    if (token === undefined) return next();
    if (!safeEqual(token, opts.token))
      return c.text("Invalid or expired link. Use the URL printed in the terminal.", 403);
    setCookie(c, SESSION_COOKIE, opts.sessionValue, { httpOnly: true, sameSite: "Strict", path: "/api" });
    return c.redirect("/", 303);
  });

  const api = new Hono();
  api.use("*", apiGuard({ allowedOrigin: opts.allowedOrigin, sessionValue: opts.sessionValue }));

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

  // Built UI with SPA fallback to index.html.
  app.get("*", (c) => {
    if (!opts.webDist) return c.text("BukitJalil server is running. In development, open the Vite URL.", 404);
    let resolved = resolveStaticFile(opts.webDist, new URL(c.req.url).pathname);
    if (!resolved.ok && resolved.status === 404) resolved = resolveStaticFile(opts.webDist, "/index.html");
    if (!resolved.ok) return c.body(null, resolved.status);
    // Only Vite's content-hashed files under /assets/ are safe to cache forever.
    const hashed = new URL(c.req.url).pathname.startsWith("/assets/");
    return c.body(fs.readFileSync(resolved.file), 200, {
      "Content-Type": contentType(resolved.file),
      "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-store",
    });
  });

  return app;
}
