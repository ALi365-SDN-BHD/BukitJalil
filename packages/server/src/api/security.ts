import { ChangePinRequest, IdleRequest, PinRequest } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { apiError } from "../security/guard.ts";
import type { SecurityService } from "../security/pin.ts";
import { body } from "./common.ts";

/** Paths under /api that answer while the app is locked (plan 6.9). */
export function openWhileLocked(pathname: string): boolean {
  return pathname === "/api/health" || pathname === "/api/security" || pathname.startsWith("/api/security/");
}

/**
 * The app lock (plan 6.9): status, first PIN, unlock, lock, change PIN, idle lock, activity, reset after a
 * forgotten PIN. SiteErrors reach onError.
 */
export function securityRoutes(api: Hono<AppEnv>, security: SecurityService) {
  api.get("/security", (c) => c.json(security.status()));
  api.post("/security/setup", async (c) => {
    const req = await body(c, PinRequest);
    return req ? c.json(security.setup(req.pin)) : apiError(c, 400, "request.invalid_body");
  });
  api.post("/security/unlock", async (c) => {
    const req = await body(c, PinRequest);
    return req ? c.json(security.unlock(req.pin)) : apiError(c, 400, "request.invalid_body");
  });
  api.post("/security/lock", (c) => c.json(security.lock()));
  api.post("/security/change-pin", async (c) => {
    const req = await body(c, ChangePinRequest);
    return req ? c.json(security.changePin(req.currentPin, req.nextPin)) : apiError(c, 400, "request.invalid_body");
  });
  api.post("/security/idle", async (c) => {
    const req = await body(c, IdleRequest);
    return req ? c.json(security.setIdleMinutes(req.minutes)) : apiError(c, 400, "request.invalid_body");
  });
  api.post("/security/touch", (c) => c.json(security.touch()));
  api.post("/security/reset", (c) => c.json(security.reset(), 202));
}
