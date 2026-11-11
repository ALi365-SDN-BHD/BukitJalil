import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { silentLogger } from "../src/log.ts";
import { PreviewPool } from "../src/preview/pool.ts";
import { httpGet } from "./helpers.ts";

const BASE = 48810; // away from the defaults so a running dev server does not interfere
const pools: PreviewPool[] = [];
const blockers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((p) => p.closeAll()));
  await Promise.all(blockers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function site(content: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bj-preview-"));
  fs.writeFileSync(path.join(dir, "index.html"), content);
  return dir;
}

const get = httpGet;

describe("PreviewPool (plan 8.4)", () => {
  it("gives each slot its own port, skips busy and reserved ports", async () => {
    const blocker = http.createServer();
    await new Promise<void>((r) => blocker.listen(BASE + 1, "127.0.0.1", r));
    blockers.push(blocker);
    const pool = new PreviewPool(BASE, new Set([BASE]), silentLogger);
    pools.push(pool);
    const a = await pool.open("site1:main", site("A"));
    const b = await pool.open("site1:change", site("B"));
    expect(a.port).toBe(BASE + 2);
    expect(b.port).toBe(BASE + 3);
    expect((await get(a.port)).body).toBe("A");
    expect((await get(b.port)).body).toBe("B");
  });

  it("re-points an existing slot to a new build on the same port", async () => {
    const pool = new PreviewPool(BASE, new Set(), silentLogger);
    pools.push(pool);
    const first = await pool.open("s:change", site("v1"));
    const second = await pool.open("s:change", site("v2"));
    expect(second.port).toBe(first.port);
    expect((await get(first.port)).body).toBe("v2");
  });

  it("redirects / to the entry of a build without a root home page, and stops when re-pointed", async () => {
    const pool = new PreviewPool(BASE, new Set(), silentLogger);
    pools.push(pool);
    const multi = fs.mkdtempSync(path.join(os.tmpdir(), "bj-preview-"));
    fs.mkdirSync(path.join(multi, "zh-CN"));
    fs.writeFileSync(path.join(multi, "zh-CN", "index.html"), "zh");
    const { port } = await pool.open("s:main", multi, "/zh-CN/");
    const home = await get(port, { path: "/?x=1" });
    expect(home.status).toBe(302);
    expect(home.headers.location).toBe("/zh-CN/");
    expect(home.headers["content-security-policy"]).toContain("sandbox");
    expect((await get(port, { path: "/zh-CN/" })).body).toBe("zh");
    pool.repoint("s:main", site("plain"));
    expect((await get(port)).body).toBe("plain");
  });

  it("sends sandbox CSP, no-store and nosniff", async () => {
    const pool = new PreviewPool(BASE, new Set(), silentLogger);
    pools.push(pool);
    const { port } = await pool.open("s:main", site("x"));
    const res = await get(port);
    expect(res.headers["content-security-policy"]).toBe(
      "sandbox allow-scripts allow-popups; connect-src 'none'; form-action 'none'",
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("checks Host against its own port and only allows GET/HEAD", async () => {
    const pool = new PreviewPool(BASE, new Set(), silentLogger);
    pools.push(pool);
    const { port } = await pool.open("s:main", site("x"));
    expect((await get(port, { host: `localhost:${port}` })).status).toBe(200);
    expect((await get(port, { host: "127.0.0.1:47880" })).status).toBe(421);
    expect((await get(port, { host: "evil.example" })).status).toBe(421);
    expect((await get(port, { method: "POST" })).status).toBe(405);
    expect((await get(port, { path: "/../../etc/passwd" })).status).toBe(400);
  });

  it("shares one server between concurrent opens of the same slot; the later root wins", async () => {
    const pool = new PreviewPool(BASE, new Set(), silentLogger);
    pools.push(pool);
    const [a, b] = await Promise.all([pool.open("s:change", site("v1")), pool.open("s:change", site("v2"))]);
    expect(a.port).toBe(b.port);
    expect(pool.list()).toEqual([{ key: "s:change", port: a.port }]);
    expect((await get(a.port)).body).toBe("v2");
    await pool.closeAll();
    await expect(get(a.port)).rejects.toThrow(); // no leaked server still answering
  });

  it("closes slots and frees their ports", async () => {
    const pool = new PreviewPool(BASE, new Set(), silentLogger);
    pools.push(pool);
    const { port } = await pool.open("s:main", site("x"));
    await pool.close("s:main");
    expect(pool.list()).toEqual([]);
    await expect(get(port)).rejects.toThrow();
  });
});
