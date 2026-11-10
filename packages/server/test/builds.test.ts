import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Build, BuildListResponse, PreviewResponse, ServerEvent, Site } from "@bukitjalil/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { KEEP_OUTPUTS } from "../src/builds/service.ts";
import { BuildStore } from "../src/builds/store.ts";
import { BukitService } from "../src/bukit/locate.ts";
import { resolveGitPath } from "../src/git/run.ts";
import { silentLogger } from "../src/log.ts";
import { PreviewPool } from "../src/preview/pool.ts";
import { copyStarter } from "../src/sites/template.ts";
import { openDatabase } from "../src/store/db.ts";
import { ADMIN, commitAllAs, httpGet, makeApp, rawGit, req } from "./helpers.ts";

const STARTER = path.resolve(import.meta.dirname, "../../../templates/starter");
const REAL_BIN = process.env.BUKIT_BIN;
const _gitPath = resolveGitPath() as string;

/**
 * Stand-in for bukit. `build` reads the committed file fake-mode: "" writes index.html with the
 * committed marker, "fail" exits 2, "full" fails as on a full disk, "symlink" puts a link in the output,
 * "slow" waits for SIGINT.
 */
const FAKE_BUKIT = `#!/bin/sh
case "$1" in
  version) echo "bukit 2.0.11+fake"; exit 0;;
  config) exit 0;;
  build)
    out=""; prev=""
    for a in "$@"; do if [ "$prev" = "--output" ]; then out="$a"; fi; prev="$a"; done
    mode=$(cat fake-mode 2>/dev/null)
    echo '{"ts":"t","level":"info","msg":"event=build.start"}'
    case "$mode" in
      fail) echo '{"ts":"t","level":"error","msg":"event=content.error file=x.md"}'; echo "boom" >&2; exit 2;;
      full) echo "write index.html: no space left on device" >&2; exit 1;;
      fulljson) echo '{"ts":"t","level":"error","msg":"event=output.failed error=no space left on device"}'; exit 3;;
      symlink) mkdir -p "$out"; echo hi > "$out/index.html"; ln -s /etc/hosts "$out/leak";;
      slow) trap 'exit 130' INT; while true; do sleep 0.05; done;;
      *) mkdir -p "$out"; echo "<h1>$(cat marker 2>/dev/null)</h1>" > "$out/index.html";;
    esac
    echo '{"ts":"t","level":"warn","msg":"event=theme.warning x=1"}'
    exit 0;;
esac
exit 1
`;

let base: string;
let userHome: string;
let fakeBin: string;
const contexts: ReturnType<typeof makeApp>[] = [];

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-builds-")));
  userHome = path.join(base, "home");
  fs.mkdirSync(userHome);
  fakeBin = path.join(base, "fake-bukit");
  fs.writeFileSync(fakeBin, FAKE_BUKIT, { mode: 0o755 });
});
afterEach(async () => {
  await Promise.all(
    contexts.splice(0).map(async (ctx) => {
      await ctx.builds.shutdown();
      await ctx.previews.closeAll();
    }),
  );
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const raw = (cwd: string, ...args: string[]) => rawGit(base, cwd, ...args);
const commitAll = (dir: string, message: string) => commitAllAs(base, dir, message);

function bukitFor(bin: string | null) {
  return new BukitService({
    home: path.join(base, "bk"),
    tmpDir: path.join(base, "bk-tmp"),
    customPath: () => bin,
    envPath: "",
  });
}

let lastPreviewBase = 49600;
/** Each app gets its own preview port range. */
const nextPreviewBase = () => {
  lastPreviewBase += 20;
  return lastPreviewBase;
};

/**
 * A committed starter site, imported. With a usable Bukit the import starts the first build (plan 5.2
 * step 5), which is awaited here; `mode` is committed afterwards, so it applies to the builds a test starts.
 */
async function setup(name: string, opts: { mode?: string; bin?: string | null } = {}) {
  const ctx = makeApp({
    userHome,
    appHome: fs.mkdtempSync(path.join(base, "app-")),
    bukit: bukitFor(opts.bin === undefined ? fakeBin : opts.bin),
    previewBase: nextPreviewBase(),
  });
  contexts.push(ctx);
  const dir = path.join(userHome, name);
  copyStarter(STARTER, dir, { title: name, language: "en-US" });
  fs.writeFileSync(path.join(dir, "marker"), "v1");
  raw(dir, "init", "-q", "-b", "main");
  commitAll(dir, "init");
  const site = await ctx.sites.import({ path: dir });
  await ctx.builds.settled();
  if (opts.mode) {
    fs.writeFileSync(path.join(dir, "fake-mode"), opts.mode);
    commitAll(dir, `mode ${opts.mode}`);
  }
  const call = async <T>(method: string, p: string, body?: unknown) => {
    const init: RequestInit =
      method === "GET"
        ? {}
        : {
            method,
            body: JSON.stringify(body ?? {}),
            headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
          };
    const res = await ctx.app.fetch(req(p, init));
    return { status: res.status, json: (await res.json()) as T };
  };
  const api = (p: string) => `/api/sites/${site.id}${p}`;
  const history = async () => (await call<BuildListResponse>("GET", api("/builds"))).json.builds;
  /** Start a main build through the API and wait for it. */
  const build = async (): Promise<Build> => {
    const res = await call<Build>("POST", api("/builds"), { ref: "main" });
    expect(res.status).toBe(202);
    await ctx.builds.settled();
    return (await call<Build>("GET", api(`/builds/${res.json.id}`))).json;
  };
  return { ...ctx, dir, site, call, api, history, build };
}

const fetchPreview = (port: number) => httpGet(port);

describe("main builds (plan 8.3, 8.4)", () => {
  it("builds in the main checkout and keeps the output under previews/", async () => {
    const s = await setup("ok");
    expect(s.site).toMatchObject({ readOnly: null, configCheck: "ok" });
    const b = await s.build();
    expect(b).toMatchObject({ status: "succeeded", outcome: "ok", exitCode: 0, hasOutput: true, ref: "main" });
    expect(b.commit).toBe(raw(s.dir, "rev-parse", "main").trim());
    expect(b.report?.messages).toEqual([{ level: "warn", msg: "event=theme.warning x=1" }]);
    expect(b).not.toHaveProperty("outputDir");
    const out = path.join(s.paths.previews, s.site.id, b.id);
    expect(fs.readFileSync(path.join(out, "index.html"), "utf8")).toContain("v1");
    // Nothing is written into the site directory, and the temporary output is gone.
    expect(fs.existsSync(path.join(s.dir, ".bukitjalil-build"))).toBe(false);
    expect(fs.readdirSync(path.join(s.paths.worktrees, s.site.id, "main", ".bukitjalil-build"))).toEqual([]);
  });

  it("publishes build.start and build.end on the event stream", async () => {
    const s = await setup("events");
    const got: ServerEvent[] = [];
    const sub = s.events.subscribe(
      undefined,
      (e) => got.push(e),
      () => {},
    );
    try {
      const b = await s.build();
      const mine = got.filter((e) => e.type === "build.start" || e.type === "build.end");
      expect(mine.map((e) => [e.type, "siteId" in e && e.siteId])).toEqual([
        ["build.start", s.site.id],
        ["build.end", s.site.id],
      ]);
      expect(mine[0]?.data).toMatchObject({ build: { id: b.id, status: "running" } });
      // The end carries the finished record with its report.
      expect(mine[1]?.data).toEqual({ build: b });
    } finally {
      sub.close();
    }
  });

  it("serves the newest build on its own preview port and switches when a new one succeeds", async () => {
    const s = await setup("preview");
    const first = await s.build();
    const opened = await s.call<PreviewResponse>("POST", s.api("/preview"), { ref: "main" });
    expect(opened.json).toMatchObject({ ref: "main", buildId: first.id, commit: first.commit });
    expect(opened.json.url).toBe(`http://127.0.0.1:${opened.json.port}/`);
    const page = await fetchPreview(opened.json.port);
    expect(page.body).toContain("v1");
    expect(page.headers["content-security-policy"]).toMatch(/^sandbox allow-scripts allow-popups/);
    expect(page.headers["cache-control"]).toBe("no-store");

    fs.writeFileSync(path.join(s.dir, "marker"), "v2");
    commitAll(s.dir, "v2");
    const second = await s.build();
    expect(second.status).toBe("succeeded");
    expect((await fetchPreview(opened.json.port)).body).toContain("v2");
    const again = await s.call<PreviewResponse>("POST", s.api("/preview"), {});
    expect(again.json).toMatchObject({ port: opened.json.port, buildId: second.id });
  });

  it("records a failed build with Bukit's errors and keeps nothing", async () => {
    const s = await setup("fail", { mode: "fail" });
    const b = await s.build();
    expect(b).toMatchObject({ status: "failed", outcome: "config_or_content_error", exitCode: 2, hasOutput: false });
    expect(b.report?.messages).toEqual([{ level: "error", msg: "event=content.error file=x.md" }]);
    expect(b.report?.output).toContain("boom");
    expect(fs.existsSync(path.join(s.paths.worktrees, s.site.id, "main", ".bukitjalil-build", b.id))).toBe(false);
    expect(fs.existsSync(path.join(s.paths.previews, s.site.id, b.id))).toBe(false);
  });

  it("names a full disk behind a failed build", async () => {
    const s = await setup("full", { mode: "full" });
    const b = await s.build();
    expect(b).toMatchObject({ status: "failed", outcome: "failed", exitCode: 1 });
    expect(b.report?.problem).toBe("fs.disk_full");
    const logged = await (await setup("fulljson", { mode: "fulljson" })).build();
    expect(logged).toMatchObject({ outcome: "render_error", report: { problem: "fs.disk_full" } });
    const plain = await (await setup("fail2", { mode: "fail" })).build();
    expect(plain.report?.problem).toBeUndefined();
  });

  it("does not keep an output that contains a symbolic link", async () => {
    const s = await setup("symlink-out", { mode: "symlink" });
    const b = await s.build();
    expect(b).toMatchObject({ status: "failed", outcome: "symlink", hasOutput: false });
    expect(b.report?.detail).toBe("leak");
  });

  it("re-runs the pre-build guard on the commit it builds", async () => {
    const s = await setup("guarded");
    fs.symlinkSync("../site.yaml", path.join(s.dir, "content", "link.md"));
    commitAll(s.dir, "add a symlink");
    const b = await s.build();
    expect(b).toMatchObject({ status: "failed", outcome: "refused", hasOutput: false });
    expect(b.report?.reasons?.map((r) => r.code)).toContain("symlink");
    // The site follows: it is read-only now, so no further build is offered.
    expect(s.sites.get(s.site.id).readOnly?.map((r) => r.code)).toContain("symlink");
    expect((await s.call("POST", s.api("/builds"), {})).json).toEqual({ code: "site.read_only" });
  });

  it("holds the site lock while building and stops at shutdown", async () => {
    const s = await setup("slow", { mode: "slow" });
    const started = await s.call<Build>("POST", s.api("/builds"), {});
    expect(started.json).toMatchObject({ status: "running", outcome: null });
    expect((await s.call("POST", s.api("/builds"), {})).json).toEqual({
      code: "site.busy",
      params: { operation: "build" },
    });
    expect((await s.call("POST", s.api("/recheck"))).status).toBe(409);
    await s.builds.shutdown();
    expect((await s.history())[0]).toMatchObject({ status: "failed", outcome: "stopped" });
  });

  it("keeps the newest outputs and drops older ones", async () => {
    const s = await setup("prune");
    const ids: string[] = [];
    for (let i = 0; i < KEEP_OUTPUTS + 2; i++) ids.push((await s.build()).id);
    const kept = fs.readdirSync(path.join(s.paths.previews, s.site.id)).sort();
    expect(kept).toEqual(ids.slice(-KEEP_OUTPUTS).sort());
    const list = await s.history();
    expect(list).toHaveLength(KEEP_OUTPUTS + 3); // with the first build after the import
    expect(list.filter((b) => b.hasOutput)).toHaveLength(KEEP_OUTPUTS);
    // The list leaves reports out; the single build has it.
    expect(list.every((b) => b.report === null)).toBe(true);
    expect((await s.call<Build>("GET", s.api(`/builds/${ids[0]}`))).json.report).not.toBeNull();
    expect((await s.call("GET", s.api("/builds/ffffffffffffffff"))).json).toEqual({ code: "build.not_found" });
  });

  it("refuses what it cannot build", async () => {
    const s = await setup("refuse");
    expect((await s.call("POST", s.api("/builds"), { ref: "change" })).json).toEqual({ code: "change.not_found" });
    expect((await s.call("POST", s.api("/preview"), { ref: "change" })).json).toEqual({ code: "change.not_found" });
    expect((await s.call("POST", s.api("/builds"), { ref: "x" })).status).toBe(400);
    expect((await s.call("POST", "/api/sites/0000000000000000/builds", {})).json).toEqual({ code: "site.not_found" });

    const nobukit = await setup("nobukit", { bin: null });
    expect((await nobukit.call("POST", nobukit.api("/builds"), {})).json).toEqual({ code: "build.bukit_missing" });
    expect((await nobukit.call("POST", nobukit.api("/preview"), {})).json).toEqual({ code: "preview.not_built" });

    const ro = await setup("readonly");
    raw(ro.dir, "config", "core.fsmonitor", "/bin/false");
    await ro.sites.recheck(ro.site.id);
    expect((await ro.call("POST", ro.api("/builds"), {})).json).toEqual({ code: "site.read_only" });
  });

  it("falls back to an older output when the newest one is gone", async () => {
    const s = await setup("fallback");
    const [older] = await s.history();
    const newest = await s.build();
    fs.rmSync(path.join(s.paths.previews, s.site.id, newest.id), { recursive: true });
    const opened = await s.call<PreviewResponse>("POST", s.api("/preview"), {});
    expect(opened.json.buildId).toBe(older?.id);
    expect((await s.call<Build>("GET", s.api(`/builds/${newest.id}`))).json.hasOutput).toBe(false);
  });

  it("refuses new builds once shutdown has begun", async () => {
    const s = await setup("closing");
    await s.builds.shutdown();
    expect((await s.call("POST", s.api("/builds"), {})).json).toEqual({ code: "server.shutting_down" });
  });

  it("gives back preview ports when the site is removed", async () => {
    const s = await setup("removed");
    await s.build();
    await s.call("POST", s.api("/preview"), {});
    expect(s.previews.list()).toHaveLength(1);
    expect((await s.call("DELETE", s.api(""))).status).toBe(200);
    expect(s.previews.list()).toEqual([]);
  });
});

describe("first build after adding a site (plan 5.2 step 5)", () => {
  it("builds a site imported through the API", async () => {
    const ctx = makeApp({
      userHome,
      appHome: fs.mkdtempSync(path.join(base, "app-")),
      bukit: bukitFor(fakeBin),
      previewBase: nextPreviewBase(),
    });
    contexts.push(ctx);
    const dir = path.join(userHome, "auto");
    copyStarter(STARTER, dir, { title: "Auto", language: "en-US" });
    raw(dir, "init", "-q", "-b", "main");
    commitAll(dir, "init");
    const res = await ctx.app.fetch(
      req("/api/sites/import", {
        method: "POST",
        body: JSON.stringify({ path: dir }),
        headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
      }),
    );
    const site = (await res.json()) as Site;
    expect(res.status).toBe(201);
    await ctx.builds.settled();
    expect(ctx.builds.list(site.id)).toMatchObject([{ status: "succeeded", outcome: "ok" }]);
  });
});

describe("build records", () => {
  it("closes builds left running by a previous process", () => {
    const db = openDatabase(":memory:");
    db.prepare(
      "INSERT INTO sites (id, name, path, default_branch, created_at) VALUES ('s', 'n', '/x', 'main', 't')",
    ).run();
    const store = new BuildStore(db);
    store.insert({ id: "b1", siteId: "s", commit: "c" });
    expect(store.closeInterrupted()).toBe(1);
    expect(store.get("b1")).toMatchObject({ status: "failed", outcome: "interrupted", finishedAt: expect.any(String) });
  });
});

describe("preview idle release", () => {
  it("closes a slot nobody used for the idle time", async () => {
    const pool = new PreviewPool(49950, new Set(), silentLogger, 1000);
    const dir = fs.mkdtempSync(path.join(base, "idle-"));
    fs.writeFileSync(path.join(dir, "index.html"), "x");
    try {
      const opened = Date.now();
      const { port } = await pool.open(PreviewPool.key("s", "main"), dir);
      await pool.sweep(opened + 500);
      expect(pool.list()).toHaveLength(1);
      // A request refused for its Host does not count as use.
      await new Promise((r) => setTimeout(r, 300));
      expect((await httpGet(port, { host: "evil.example" })).status).toBe(421);
      await pool.sweep(opened + 1100);
      expect(pool.list()).toEqual([]);
      // An accepted request does.
      const again = await pool.open(PreviewPool.key("s", "main"), dir);
      await new Promise((r) => setTimeout(r, 300));
      const used = Date.now();
      await fetchPreview(again.port);
      await pool.sweep(used + 900);
      expect(pool.list()).toHaveLength(1);
    } finally {
      await pool.closeAll();
    }
  });
});

describe.skipIf(!REAL_BIN)("real Bukit", () => {
  it("builds the starter site and serves it", async () => {
    const s = await setup("real", { bin: REAL_BIN as string });
    const b = await s.build();
    expect(b).toMatchObject({ status: "succeeded", outcome: "ok", exitCode: 0 });
    const opened = await s.call<PreviewResponse>("POST", s.api("/preview"), {});
    const page = await fetchPreview(opened.json.port);
    expect(page.status).toBe(200);
    expect(page.body).toContain("<html");
  }, 120_000);
});
