import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AiBukit, AiBukitError } from "../src/agent/ai-bukit.ts";
import { PathGate } from "../src/agent/gate.ts";
import { createSiteTools, type SITE_TOOLS, schemaText } from "../src/agent/site-tools.ts";
import { BukitService } from "../src/bukit/locate.ts";
import { copyStarter } from "../src/sites/template.ts";
import { commitAllAs, installAppBukit, makeApp, rawGit, testBukitDir } from "./helpers.ts";

const STARTER = path.resolve(import.meta.dirname, "../../../templates/starter");
const SKILLS = path.resolve(import.meta.dirname, "../../../skills");

let base: string;
let calls: string;
let fakeBin: string;
let versionFile: string;
const contexts: ReturnType<typeof makeApp>[] = [];

/**
 * Stand-in for bukit that logs each call (cwd and arguments) to $CALLS. Files in the checkout steer it:
 * fake-doctor makes doctor fail, fake-build=fail makes build exit 2 and fake-build=slow waits for SIGINT.
 * `version` prints the version in $VERSION_FILE when it exists.
 */
const fakeBukit = (log: string, versionFile: string) => `#!/bin/sh
echo "$(pwd) $*" >> ${JSON.stringify(log)}
case "$1" in
  version) if [ -f ${JSON.stringify(versionFile)} ]; then cat ${JSON.stringify(versionFile)}; else echo "bukit 2.0.11+fake"; fi; exit 0;;
  config)
    if [ "$2" = "schema" ]; then
      echo '{"type":"object","properties":{"site":{"type":"object","description":"site section"},"theme":{"type":"object"}}}' > "$4"
    fi
    echo "config ok"; exit 0;;
  doctor) if [ -f fake-doctor ]; then echo "doctor: template missing"; exit 1; fi; echo "doctor ok"; exit 0;;
  build)
    out=""; prev=""
    for a in "$@"; do if [ "$prev" = "--output" ]; then out="$a"; fi; prev="$a"; done
    if [ "$(cat fake-build 2>/dev/null)" = "fail" ]; then
      echo '{"ts":"t","level":"error","msg":"event=content.error file=x.md"}'; exit 2
    fi
    if [ "$(cat fake-build 2>/dev/null)" = "slow" ]; then
      trap 'exit 130' INT; while true; do sleep 0.05; done
    fi
    mkdir -p "$out/blog"; echo "<h1>home</h1>" > "$out/index.html"; echo "<h1>post</h1>" > "$out/blog/index.html"
    echo '{"ts":"t","level":"warn","msg":"event=theme.warning x=1"}'
    exit 0;;
esac
exit 1
`;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-site-tools-")));
  fs.mkdirSync(path.join(base, "home"));
  calls = path.join(base, "calls.log");
  fakeBin = path.join(base, "fake-bukit");
  versionFile = path.join(base, "fake-version");
  fs.writeFileSync(fakeBin, fakeBukit(calls, versionFile), { mode: 0o755 });
});
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.builds.shutdown()));
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

let n = 0;
/**
 * An imported starter site with a session and its change set (so the ai/ checkout), an AiBukit on the
 * fake Bukit, and the site tools. The tools run outside an AI run here, so nothing holds the site lock.
 */
async function setup(opts: { bin?: string | null; files?: Record<string, string> } = {}) {
  const home = path.join(base, `bk-${++n}`);
  installAppBukit(home, opts.bin === undefined ? fakeBin : opts.bin);
  const bukit = new BukitService({
    dir: testBukitDir(home),
    tmpDir: path.join(base, `bk-tmp-${n}`),
  });
  const ctx = makeApp({ userHome: path.join(base, "home"), appHome: path.join(base, `app-${n}`), bukit });
  contexts.push(ctx);
  const dir = path.join(base, "home", `site${n}`);
  copyStarter(STARTER, dir, { title: `Site ${n}`, language: "en-US" });
  for (const [name, content] of Object.entries(opts.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  rawGit(base, dir, "init", "-q", "-b", "main");
  commitAllAs(base, dir);
  const site = await ctx.sites.import({ path: dir });
  await ctx.builds.settled(); // the first main build after import holds the site lock
  const session = ctx.agent.create(site.id);
  const { cwd } = await ctx.changes.begin(site.id, session.id);
  const ai = new AiBukit({ git: ctx.git, paths: ctx.paths, sites: ctx.sites, bukit, changes: ctx.changes });
  const snapshot = () => ctx.changes.snapshot(site.id, cwd);
  const summaries: string[] = [];
  const tools = Object.fromEntries(
    createSiteTools({
      siteId: site.id,
      cwd,
      gate: new PathGate(cwd, [SKILLS]),
      bukit: ai,
      onSummary: (s) => summaries.push(s),
    }).map((t) => [t.name, t]),
  ) as Record<(typeof SITE_TOOLS)[number], ToolDefinition>;
  fs.rmSync(calls, { force: true });
  const git = (...args: string[]) => rawGit(base, cwd, ...args).trim();
  return { ctx, site, cwd, ai, tools, summaries, git, snapshot };
}

async function waitFor(condition: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const bukitCalls = () => (fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : []);

async function call(tool: ToolDefinition, params: Record<string, unknown> = {}) {
  const result = await tool.execute("id", params as never, undefined, undefined, undefined as never);
  const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  return { text, value: JSON.parse(text.startsWith("{") ? text : "null") as Record<string, unknown> | null };
}

describe("snapshot", () => {
  it("commits the checkout and moves HEAD; nothing changes when nothing did", async () => {
    const { cwd, git, snapshot } = await setup();
    const before = git("rev-parse", "HEAD");
    expect(await snapshot()).toEqual({ commit: before, removed: [] });

    fs.writeFileSync(path.join(cwd, "content/pages/new.md"), "---\ntitle: New\n---\n");
    fs.rmSync(path.join(cwd, "content/pages/about.md"));
    const { commit } = await snapshot();
    expect(commit).not.toBe(before);
    expect(git("rev-parse", "HEAD")).toBe(commit);
    expect(git("rev-parse", "HEAD^")).toBe(before);
    expect(git("status", "--porcelain")).toBe("");
    expect(git("show", "--name-status", "--format=%an <%ae>", "HEAD")).toBe(
      "BukitJalil <ai@bukitjalil.invalid>\n\nD\tcontent/pages/about.md\nA\tcontent/pages/new.md",
    );
    expect((await snapshot()).commit).toBe(commit);
  });

  it("deletes new files that .gitignore hides from the snapshot; tracked files stay in it", async () => {
    const { cwd, git, snapshot } = await setup();
    // A tracked file is still committed when .gitignore lists it.
    fs.appendFileSync(path.join(cwd, ".gitignore"), "\nsite.yaml\nnotes/\n");
    fs.appendFileSync(path.join(cwd, "site.yaml"), "# changed\n");
    expect((await snapshot()).removed).toEqual([]);
    expect(git("show", "HEAD:site.yaml")).toContain("# changed");
    // A new, ignored file would reach Bukit without the guard seeing it: it is deleted.
    fs.mkdirSync(path.join(cwd, "notes"));
    fs.writeFileSync(path.join(cwd, "notes", "x.md"), "x");
    expect((await snapshot()).removed).toEqual(["notes/"]);
    expect(fs.existsSync(path.join(cwd, "notes"))).toBe(false);
    // Deleting site.yaml, snapshotting and writing it back makes it new and ignored too.
    fs.renameSync(path.join(cwd, "site.yaml"), path.join(base, `held-${n}.yaml`));
    await snapshot();
    fs.renameSync(path.join(base, `held-${n}.yaml`), path.join(cwd, "site.yaml"));
    expect((await snapshot()).removed).toEqual(["site.yaml"]);
    expect(fs.existsSync(path.join(cwd, "site.yaml"))).toBe(false);
  });

  it("keeps build output and caches out of the commit, even when .gitignore un-ignores them", async () => {
    const { cwd, git, snapshot } = await setup();
    fs.appendFileSync(path.join(cwd, ".gitignore"), "\n!dist/\n!.bukit/\n!.CACHE/\n");
    for (const d of ["dist", ".bukit", ".cache", ".bukitjalil-build", "node_modules"]) {
      fs.mkdirSync(path.join(cwd, d), { recursive: true });
      fs.writeFileSync(path.join(cwd, d, "f"), "x");
    }
    const { commit, removed } = await snapshot();
    expect(removed).toEqual([]);
    expect(git("show", "--name-only", "--format=", commit)).toBe(".gitignore");
    for (const d of ["dist", ".bukit", ".cache"]) expect(fs.existsSync(path.join(cwd, d, "f"))).toBe(true);
  });
});

describe("bukit_check and bukit_build", () => {
  it("checks the snapshot in the AI checkout: config check, then doctor", async () => {
    const { tools, cwd, git } = await setup();
    fs.writeFileSync(path.join(cwd, "content/pages/new.md"), "---\ntitle: New\n---\n");
    const r = await call(tools.bukit_check);
    expect(r.value).toMatchObject({
      passed: true,
      steps: [
        { command: "config check", passed: true, exitCode: 0 },
        { command: "doctor", passed: true, exitCode: 0 },
      ],
    });
    expect(bukitCalls()).toEqual([`${cwd} config check --config site.yaml`, `${cwd} doctor --config site.yaml`]);
    expect(git("status", "--porcelain")).toBe("");

    fs.writeFileSync(path.join(cwd, "fake-doctor"), "");
    const failed = await call(tools.bukit_check);
    expect(failed.value).toMatchObject({ passed: false, steps: [{ passed: true }, { passed: false, exitCode: 1 }] });
    expect(failed.text).toContain("template missing");
  });

  it("builds into a temporary folder, counts pages and removes the output", async () => {
    const { tools, cwd } = await setup();
    const r = await call(tools.bukit_build);
    expect(r.value).toMatchObject({
      succeeded: true,
      pages: 2,
      messages: [{ level: "warn", msg: "event=theme.warning x=1" }],
    });
    const [line] = bukitCalls();
    expect(line).toMatch(
      new RegExp(
        `^${cwd} build --config site.yaml --output \\.bukitjalil-build/ai-[0-9a-f]{12} --base-url / --no-clean --log-format json$`,
      ),
    );
    expect(fs.readdirSync(path.join(cwd, ".bukitjalil-build"))).toEqual([]);

    fs.writeFileSync(path.join(cwd, "fake-build"), "fail");
    const failed = await call(tools.bukit_build);
    expect(failed.value).toMatchObject({ succeeded: false, pages: 0, messages: [{ level: "error" }] });
    expect(failed.text).toContain("configuration or content error");
  });

  it("builds under the site's own baseUrl, and does not run Bukit for one a preview cannot use", async () => {
    const { tools, cwd } = await setup();
    const yaml = path.join(cwd, "site.yaml");
    fs.writeFileSync(yaml, fs.readFileSync(yaml, "utf8").replace("baseUrl: /", "baseUrl: /docs/v2"));
    expect((await call(tools.bukit_build)).value).toMatchObject({ succeeded: true });
    expect(bukitCalls()[0]).toContain(" --base-url /docs/v2/ ");

    fs.writeFileSync(yaml, fs.readFileSync(yaml, "utf8").replace("baseUrl: /docs/v2", "baseUrl: /a b/"));
    const before = bukitCalls().length;
    const bad = await call(tools.bukit_build);
    expect(bad.value).toMatchObject({ succeeded: false, pages: 0, messages: [{ level: "error" }] });
    expect(bad.text).toContain("site.baseUrl");
    expect(bukitCalls()).toHaveLength(before);
  });

  it("does not run Bukit when the pre-build guard refuses the snapshot", async () => {
    const { tools, cwd } = await setup();
    const yaml = path.join(cwd, "site.yaml");
    fs.writeFileSync(
      yaml,
      fs.readFileSync(yaml, "utf8").replace("build:\n  output: dist", "build:\n  output: ../outside"),
    );
    await expect(call(tools.bukit_build)).rejects.toMatchObject({
      code: "guard",
      message: expect.stringContaining("build.output"),
    });
    await expect(call(tools.bukit_check)).rejects.toThrow(AiBukitError);
    expect(bukitCalls()).toEqual([]);
  });

  it("refuses sites with a Notion source: unreviewed changes never get its token", async () => {
    const { tools, cwd } = await setup();
    const yaml = path.join(cwd, "site.yaml");
    fs.writeFileSync(
      yaml,
      fs
        .readFileSync(yaml, "utf8")
        .replace(
          "content:\n  sources:\n",
          "content:\n  sources:\n    - type: notion\n      name: db\n      collection: post\n      notion:\n        databaseId: abc\n",
        ),
    );
    await expect(call(tools.bukit_check)).rejects.toMatchObject({ code: "notion" });
    expect(bukitCalls()).toEqual([]);
  });

  it("tells the AI which ignored files it deleted", async () => {
    const { tools, cwd } = await setup();
    fs.appendFileSync(path.join(cwd, ".gitignore"), "\ndrafts/\n");
    fs.mkdirSync(path.join(cwd, "drafts"));
    fs.writeFileSync(path.join(cwd, "drafts", "a.md"), "a");
    const r = await call(tools.bukit_check);
    expect(r.value).toMatchObject({ passed: true, removedIgnoredFiles: ["drafts/"] });
    expect(r.value).not.toHaveProperty("commit");
  });

  it("stops Bukit when the tool call is aborted; settled() waits until it has", async () => {
    const { tools, cwd, ai, site } = await setup();
    fs.writeFileSync(path.join(cwd, "fake-build"), "slow");
    const abort = new AbortController();
    const running = tools.bukit_build.execute("id", {} as never, abort.signal, undefined, undefined as never);
    await waitFor(() => bukitCalls().some((l) => l.includes(" build ")));
    // What a run waits for before it lets go of the site lock.
    let settled = false;
    const waiting = ai.settled(site.id).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);
    abort.abort();
    const result = await running;
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({
      succeeded: false,
      result: "The build was stopped.",
    });
    await waiting;
    expect(settled).toBe(true);
    await expect(ai.settled(site.id)).resolves.toBeUndefined();
  });

  it("lets the site be removed during an AI build: removal stops the run first", async () => {
    const { tools, cwd, ctx, site } = await setup();
    fs.writeFileSync(path.join(cwd, "fake-build"), "slow");
    const abort = new AbortController();
    const running = tools.bukit_build.execute("id", {} as never, abort.signal, undefined, undefined as never);
    await waitFor(() => bukitCalls().some((l) => l.includes(" build ")));
    // What the agent service does for a removed site: stop its runs and wait for them.
    ctx.sites.onRemoving(async () => {
      abort.abort();
      await running.catch(() => {});
    });
    await expect(ctx.sites.remove(site.id)).resolves.toMatchObject({ leftovers: [] });
  });

  it("says so when Bukit is missing", async () => {
    const { tools } = await setup({ bin: null });
    await expect(call(tools.bukit_check)).rejects.toMatchObject({ code: "bukit_missing" });
  });
});

describe("bukit_schema", () => {
  it("returns the schema or one section, asking Bukit once", async () => {
    const { tools } = await setup();
    const all = await call(tools.bukit_schema);
    expect(all.value).toMatchObject({ properties: { site: {}, theme: {} } });
    expect((await call(tools.bukit_schema, { section: "site" })).value).toEqual({
      type: "object",
      description: "site section",
    });
    expect((await call(tools.bukit_schema, { section: "nope" })).text).toBe('No section "nope". Sections: site, theme');
    expect(bukitCalls().filter((l) => l.includes("config schema"))).toHaveLength(1);
  });

  it("asks again when Bukit at the same path reports another version", async () => {
    const { tools, ctx } = await setup();
    await call(tools.bukit_schema);
    fs.writeFileSync(versionFile, "bukit 2.0.12+fake\n");
    try {
      ctx.bukit.invalidate();
      await call(tools.bukit_schema);
    } finally {
      fs.rmSync(versionFile);
    }
    expect(bukitCalls().filter((l) => l.includes("config schema"))).toHaveLength(2);
  });

  it("cuts a large schema and names its sections", () => {
    const big = { properties: { a: { description: "x".repeat(70_000) }, b: {} } };
    const out = schemaText(big);
    expect(out.length).toBeLessThan(61_000);
    expect(out).toContain("ask for one section: a, b");
    expect(schemaText({ properties: { a: {} } }, "toString")).toContain('No section "toString"');
  });
});

describe("site_info, list_content, summarize_changes", () => {
  it("summarizes site.yaml from the working copy", async () => {
    const { tools, cwd } = await setup();
    const yaml = path.join(cwd, "site.yaml");
    fs.writeFileSync(yaml, fs.readFileSync(yaml, "utf8").replace("title: Site", "title: Changed Site"));
    const r = await call(tools.site_info);
    expect(r.value).toMatchObject({
      site: { title: expect.stringContaining("Changed Site"), language: "en-US" },
      collections: [{ name: "post" }, { name: "page" }],
      theme: { name: "starter" },
    });
    fs.writeFileSync(yaml, "site: [unclosed");
    expect((await call(tools.site_info)).value).toMatchObject({ error: expect.any(String) });
  });

  it("refuses a site.yaml that links outside the working copy", async () => {
    const { tools, cwd } = await setup();
    const secret = path.join(base, "secret.yaml");
    fs.writeFileSync(secret, "site:\n  title: SECRET\n");
    fs.rmSync(path.join(cwd, "site.yaml"));
    fs.symlinkSync(secret, path.join(cwd, "site.yaml"));
    await expect(call(tools.site_info)).rejects.toThrow(/outside/);
  });

  it("lists Markdown content with front matter, per collection", async () => {
    const { tools, cwd } = await setup();
    fs.writeFileSync(path.join(cwd, "content/posts/broken.md"), "---\ntitle: [x\n---\n");
    fs.symlinkSync(path.join(base, "calls.log"), path.join(cwd, "content/posts/link.md"));
    const all = await call(tools.list_content);
    const sources = all.value?.sources as { name: string; files: { file: string }[] }[];
    expect(sources.map((s) => s.name)).toEqual(["posts", "pages", "modules"]);
    const posts = await call(tools.list_content, { collection: "post" });
    expect(posts.value).toMatchObject({
      sources: [
        {
          name: "posts",
          dir: "content/posts",
          files: [
            { file: "content/posts/broken.md", error: expect.any(String) },
            { file: "content/posts/welcome.md", title: "Welcome", slug: "welcome", publishAt: "2026-01-01T00:00:00Z" },
          ],
        },
      ],
      truncated: false,
    });
    expect((await call(tools.list_content, { collection: "nope" })).value).toEqual({
      error: 'No content source for collection "nope"',
    });
  });

  it("hands the summary to the session", async () => {
    const { tools, summaries } = await setup();
    const r = await call(tools.summarize_changes, { summary: "  Added an FAQ page.  " });
    expect(r.text).toContain("Saved");
    expect(summaries).toEqual(["Added an FAQ page."]);
  });
});

const REAL_BIN = process.env.BUKIT_BIN;
describe.skipIf(!REAL_BIN)("real Bukit", () => {
  it("checks and builds the starter site in the AI checkout", async () => {
    const { tools, cwd } = await setup({ bin: REAL_BIN as string });
    fs.writeFileSync(
      path.join(cwd, "content/pages/faq.md"),
      "---\ncollection: page\ntitle: FAQ\nslug: faq\n---\n\n# FAQ\n",
    );
    expect((await call(tools.bukit_check)).value).toMatchObject({ passed: true });
    const build = await call(tools.bukit_build);
    expect(build.value, build.text).toMatchObject({ succeeded: true });
    expect(build.value?.pages).toBeGreaterThan(3);
    // The SEO / GEO summary from Bukit's reports (M4 layer 7).
    expect(build.value?.seoGeo).toMatch(/^SEO: \d+ pages, 0 errors/);
    expect(build.value?.seoGeo).toContain("site.url is not set");
    expect(build.value?.seoGeo).toMatch(/GEO: score \d+\/100/);
  }, 120_000);
});
