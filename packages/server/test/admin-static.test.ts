import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CSP_NONCE_PLACEHOLDER } from "../src/security/headers.ts";
import { makeApp, req } from "./helpers.ts";

let dist: string;

beforeAll(() => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), "bj-dist-"));
  fs.mkdirSync(path.join(dist, "assets"));
  fs.writeFileSync(
    path.join(dist, "index.html"),
    `<meta property="csp-nonce" nonce="${CSP_NONCE_PLACEHOLDER}"><script type="module" nonce="${CSP_NONCE_PLACEHOLDER}" src="/assets/app-abc.js"></script>`,
  );
  fs.writeFileSync(path.join(dist, "assets/app-abc.js"), "export {}");
  fs.writeFileSync(path.join(dist, "favicon.svg"), "<svg/>");
});

const get = async (p: string) => makeApp({ webDist: dist }).app.request(req(p));

describe("serving the built UI", () => {
  it("caches only hashed assets", async () => {
    const asset = await get("/assets/app-abc.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await get("/favicon.svg")).headers.get("cache-control")).toBe("no-store");
  });

  it("falls back to index.html for app routes only; missing files are 404", async () => {
    const route = await get("/sites/abc");
    expect(route.status).toBe(200);
    expect(route.headers.get("content-type")).toContain("text/html");
    expect(route.headers.get("cache-control")).toBe("no-store");
    for (const p of ["/assets/app-old.js", "/missing.png", "/robots.txt"]) {
      const res = await get(p);
      expect(res.status, p).toBe(404);
      expect(res.headers.get("cache-control"), p).toBeNull();
    }
  });

  it("puts a fresh nonce in each page and allows only that nonce for <style>", async () => {
    const nonces = [];
    for (let i = 0; i < 2; i++) {
      const res = await get("/");
      const html = await res.text();
      expect(html).not.toContain(CSP_NONCE_PLACEHOLDER);
      const nonce = /nonce="([^"]+)"/.exec(html)?.[1];
      expect(nonce).toBeTruthy();
      expect(res.headers.get("content-security-policy")).toContain(`style-src 'self' 'nonce-${nonce}'`);
      nonces.push(nonce);
    }
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  it("sends no style nonce on non-HTML responses", async () => {
    const res = await get("/assets/app-abc.js");
    expect(res.headers.get("content-security-policy")).not.toContain("style-src");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
