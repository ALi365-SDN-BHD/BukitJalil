import { CSRF_HEADER, CSRF_HEADER_VALUE, type ErrorCode } from "@bukitjalil/shared";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { safeEqual } from "./token.ts";

export function apiError(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 421 | 500 | 503 | 507,
  code: ErrorCode,
  params?: Record<string, string>,
) {
  return c.json(params && Object.keys(params).length > 0 ? { code, params } : { code }, status);
}

/** Reject any Host other than the listed ones (DNS rebinding, plan 11). */
export function hostCheck(allowedHosts: readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host") ?? "";
    if (!allowedHosts.includes(host)) return apiError(c, 421, "request.bad_host");
    await next();
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Guard for /api (plan 11):
 * - no CORS: preflights are refused and no Access-Control-* header is ever sent
 * - every request needs the session cookie
 * - non-GET requests need an exact Origin, a JSON body and the custom header
 * - no API response is cached, errors included
 */
export function apiGuard(opts: { allowedOrigin: string; cookieName: string; sessionValue: string }): MiddlewareHandler {
  return async (c, next) => {
    c.header("Cache-Control", "no-store");
    const method = c.req.method.toUpperCase();
    if (method === "OPTIONS") return apiError(c, 403, "request.cors_not_allowed");

    const cookie = getCookie(c, opts.cookieName);
    if (!cookie || !safeEqual(cookie, opts.sessionValue)) return apiError(c, 401, "auth.required");

    if (!SAFE_METHODS.has(method)) {
      if (c.req.header("origin") !== opts.allowedOrigin) return apiError(c, 403, "request.bad_origin");
      const contentType = (c.req.header("content-type") ?? "").toLowerCase();
      if (contentType.split(";")[0]?.trim() !== "application/json") {
        return apiError(c, 403, "request.bad_content_type");
      }
      if (c.req.header(CSRF_HEADER) !== CSRF_HEADER_VALUE) return apiError(c, 403, "request.missing_csrf_header");
    }
    await next();
  };
}
