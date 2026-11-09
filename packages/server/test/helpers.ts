import { createAdminApp } from "../src/app.ts";
import { openDatabase } from "../src/store/db.ts";

export const PORT = 47880;
export const ADMIN = `http://127.0.0.1:${PORT}`;
export const TOKEN = "test-token-abcdefghijklmnopqrstuvwxyz";
export const SESSION = "test-session-0123456789abcdefghijklmn";

export function makeApp(overrides: { allowedOrigin?: string } = {}) {
  const db = openDatabase(":memory:");
  const app = createAdminApp({
    port: PORT,
    allowedOrigin: overrides.allowedOrigin ?? ADMIN,
    token: TOKEN,
    sessionValue: SESSION,
    db,
    webDist: null,
    checkGit: async () => ({ ok: true, version: "2.45.0", problem: null }),
    version: "test",
  });
  return { app, db };
}

/** Build a request as the browser would send it to the admin port. */
export function req(path: string, init: RequestInit & { host?: string; cookie?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set("host", init.host ?? `127.0.0.1:${PORT}`);
  if (init.cookie !== false) headers.set("cookie", `bj_session=${SESSION}`);
  return new Request(`${ADMIN}${path}`, { ...init, headers });
}

export const jsonPut = (body: unknown, extra: Record<string, string> = {}) => ({
  method: "PUT",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN, ...extra },
});
