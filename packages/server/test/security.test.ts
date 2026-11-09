import { describe, expect, it } from "vitest";
import { ADMIN, COOKIE, jsonPut, makeApp, req, TOKEN } from "./helpers.ts";

describe("admin port security (plan 11)", () => {
  it("rejects a foreign Host with 421 (DNS rebinding)", async () => {
    const { app } = makeApp();
    for (const host of ["evil.example:47880", "127.0.0.1:47881", "127.0.0.1"]) {
      const res = await app.request(req("/api/health", { host }));
      expect(res.status, host).toBe(421);
    }
  });

  it("redirects pages opened via localhost to 127.0.0.1, where the cookie lives", async () => {
    const { app } = makeApp();
    const res = await app.request(req("/?token=x", { host: "localhost:47880", cookie: false }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ADMIN}/?token=x`);
  });

  it("requires the session cookie on every /api request", async () => {
    const { app } = makeApp();
    const res = await app.request(req("/api/health", { cookie: false }));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ code: "auth.required" });
    const wrong = await app.request(req("/api/health", { cookie: false, headers: { cookie: `${COOKIE}=nope` } }));
    expect(wrong.status).toBe(401);
  });

  it("token login sets an HttpOnly, SameSite=Strict, /api-scoped cookie and drops the token from the URL", async () => {
    const { app } = makeApp();
    const bad = await app.request(req("/?token=wrong", { cookie: false }));
    expect(bad.status).toBe(303);
    expect(bad.headers.get("location")).toBe("/");
    expect(bad.headers.get("set-cookie")).toBeNull();

    const ok = await app.request(req(`/?token=${TOKEN}`, { cookie: false }));
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/");
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^${COOKIE}=`));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api");
    expect(cookie).not.toContain(TOKEN);
  });

  it("accepts each login token once; a newly issued token replaces the previous one", async () => {
    const { app, loginToken } = makeApp();
    const first = await app.request(req(`/?token=${TOKEN}`, { cookie: false }));
    expect(first.headers.get("set-cookie")).not.toBeNull();
    const again = await app.request(req(`/?token=${TOKEN}`, { cookie: false }));
    expect(again.status).toBe(303);
    expect(again.headers.get("set-cookie")).toBeNull();

    const older = loginToken.issue();
    const newer = loginToken.issue();
    expect((await app.request(req(`/?token=${older}`, { cookie: false }))).headers.get("set-cookie")).toBeNull();
    expect((await app.request(req(`/?token=${newer}`, { cookie: false }))).headers.get("set-cookie")).not.toBeNull();
  });

  it("ignores a session cookie set for another admin port", async () => {
    const { app } = makeApp();
    const res = await app.request(req("/api/health", { cookie: false, headers: { cookie: `bj_session_47980=x` } }));
    expect(res.status).toBe(401);
  });

  it("answers unexpected errors with a code and logs the details", async () => {
    const lines: Record<string, unknown>[] = [];
    const { app } = makeApp({
      checkGit: async () => {
        throw new Error("boom");
      },
      logger: { log: (level, event, fields) => lines.push({ level, event, ...fields }) },
    });
    const res = await app.request(req("/api/health"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "server.internal" });
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(lines).toEqual([expect.objectContaining({ level: "error", event: "request.failed", error: "boom" })]);
  });

  it("sends anti-framing and CSP headers on every response, including errors", async () => {
    const { app } = makeApp();
    for (const r of [req("/api/health"), req("/api/health", { cookie: false }), req("/x", { host: "evil:1" })]) {
      const res = await app.request(r);
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("refuses CORS preflights and never sends Access-Control-* headers", async () => {
    const { app } = makeApp();
    const res = await app.request(
      req("/api/settings", {
        method: "OPTIONS",
        headers: { origin: "http://127.0.0.1:47881", "access-control-request-method": "PUT" },
      }),
    );
    expect(res.status).toBe(403);
    expect([...res.headers.keys()].some((k) => k.startsWith("access-control-"))).toBe(false);
  });

  it("GET /api/health reports git", async () => {
    const { app } = makeApp();
    const res = await app.request(req("/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { git: unknown };
    expect(body.git).toEqual({ ok: true, version: "2.45.0", problem: null });
  });

  describe("non-GET requests (cross-site request defenses)", () => {
    const cases: [string, Record<string, string>, string][] = [
      ["missing Origin", { origin: "" }, "request.bad_origin"],
      ["null Origin (sandboxed preview)", { origin: "null" }, "request.bad_origin"],
      ["preview port Origin", { origin: "http://127.0.0.1:47881" }, "request.bad_origin"],
      ["localhost Origin", { origin: "http://localhost:47880" }, "request.bad_origin"],
      ["form content type", { "content-type": "application/x-www-form-urlencoded" }, "request.bad_content_type"],
      ["text/plain (no-cors fetch / sendBeacon)", { "content-type": "text/plain" }, "request.bad_content_type"],
      ["missing X-BukitJalil", { "x-bukitjalil": "" }, "request.missing_csrf_header"],
      ["wrong X-BukitJalil", { "x-bukitjalil": "0" }, "request.missing_csrf_header"],
    ];
    for (const [name, override, code] of cases) {
      it(`rejects ${name}`, async () => {
        const { app } = makeApp();
        const init = jsonPut({ locale: "en" }, override);
        const headers = new Headers(init.headers);
        for (const [k, v] of Object.entries(override)) if (v === "") headers.delete(k);
        const res = await app.request(req("/api/settings", { ...init, headers }));
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ code });
        const after = (await (await app.request(req("/api/settings"))).json()) as { locale: string | null };
        expect(after.locale).toBeNull();
      });
    }

    it("accepts a well-formed request and persists it", async () => {
      const { app } = makeApp();
      const res = await app.request(req("/api/settings", jsonPut({ locale: "en" })));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { locale: string }).locale).toBe("en");
      const after = (await (await app.request(req("/api/settings"))).json()) as { locale: string | null };
      expect(after.locale).toBe("en");
    });

    it("accepts application/json with a charset", async () => {
      const { app } = makeApp();
      const res = await app.request(
        req("/api/settings", jsonPut({ locale: "en" }, { "content-type": "application/json; charset=utf-8" })),
      );
      expect(res.status).toBe(200);
    });

    it("uses the dev origin instead of the admin origin when configured", async () => {
      const { app } = makeApp({ allowedOrigin: "http://127.0.0.1:47890" });
      const admin = await app.request(req("/api/settings", jsonPut({ locale: "en" })));
      expect(admin.status).toBe(403);
      const dev = await app.request(
        req("/api/settings", jsonPut({ locale: "en" }, { origin: "http://127.0.0.1:47890" })),
      );
      expect(dev.status).toBe(200);
    });

    it("rejects invalid bodies and unknown settings keys", async () => {
      const { app } = makeApp();
      for (const body of ['{"locale":"fr"}', '{"evil":1}', "not json"]) {
        const init = jsonPut(null);
        const res = await app.request(req("/api/settings", { ...init, body }));
        expect(res.status, body).toBe(400);
        expect(await res.json()).toEqual({ code: "request.invalid_body" });
      }
    });
  });

  it("returns a JSON not-found code for unknown API routes", async () => {
    const { app } = makeApp();
    const res = await app.request(req("/api/nope"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "request.not_found" });
  });
});
