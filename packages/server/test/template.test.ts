import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { guardCommit } from "../src/bukit/guard.ts";
import { BukitService } from "../src/bukit/locate.ts";
import { BukitRunner, buildOutcome, checkPassed } from "../src/bukit/runner.ts";
import { GitRunner, resolveGitPath } from "../src/git/run.ts";
import { ensureAppHome } from "../src/paths.ts";
import { bukitNewSite, validateStarterValues, writeSources } from "../src/sites/template.ts";
import { STARTER_FIXTURE, writeStarter } from "./fixtures/starter.ts";

// Optional: the real Bukit, to create and build a site with `bukit new` (plan 5.2).
const REAL_BIN = process.env.BUKIT_BIN;

const gitPath = resolveGitPath();
if (!gitPath) throw new Error("git is required for these tests");

let base: string;
let git: GitRunner;
let app: ReturnType<typeof ensureAppHome>;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-template-")));
  app = ensureAppHome(path.join(base, "app"));
  git = new GitRunner({ gitPath, home: app.home, emptyFile: app.emptyGitConfig, hooksDir: app.emptyHooks });
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function listFiles(dir: string, prefix = ""): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    return e.isDirectory() ? listFiles(path.join(dir, e.name), rel) : [rel];
  });
}

/** A Bukit stand-in whose `new` records its arguments and writes a site.yaml, or fails with `fail`. */
function fakeBukit(name: string, fail = false): { service: BukitService; argsFile: string } {
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  const argsFile = path.join(dir, "args");
  const newBody = fail
    ? `echo "boom: $2" >&2; exit 2`
    : `printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}; mkdir -p "$2"; echo "site: {}" > "$2/site.yaml"; exit 0`;
  fs.writeFileSync(
    path.join(dir, "bukit"),
    `#!/bin/sh\ncase "$1" in\n  version) echo "bukit 2.2.5+fake"; exit 0;;\n  new) ${newBody};;\nesac\nexit 1\n`,
    { mode: 0o755 },
  );
  return { service: new BukitService({ dir, tmpDir: app.bukitTmp }), argsFile };
}

const runnerOpts = () => ({ git, home: app.home, tmpDir: app.bukitTmp });

describe("starter values", () => {
  it("validates the form values", () => {
    expect(validateStarterValues({ title: "My Site", language: "zh-CN" })).toBeNull();
    expect(validateStarterValues({ title: "  ", language: "en" })).toMatch(/title/);
    for (const bad of ["a\nb", "a\u202eb", "a\u200bb", "a\u2028b"]) {
      expect(validateStarterValues({ title: bad, language: "en" })).toMatch(/control/);
    }
    expect(validateStarterValues({ title: "x".repeat(201), language: "en" })).toMatch(/title/);
    expect(validateStarterValues({ title: "x", language: "en_US" })).toMatch(/language/);
    expect(validateStarterValues({ title: "x", language: "zh-Hant-TW" })).toBeNull();
  });
});

describe("bukitNewSite", () => {
  it("runs bukit new with the values as --opt=value, so a title starting with - stays a value", async () => {
    const { service, argsFile } = fakeBukit("fake-ok");
    const target = path.join(base, "created");
    await bukitNewSite(service, runnerOpts())(target, { title: "  --language ", language: "zh-CN" });
    expect(fs.readFileSync(argsFile, "utf8").split("\n").slice(0, -1)).toEqual([
      "new",
      target,
      "--title=--language",
      "--language=zh-CN",
    ]);
  });

  it("reports Bukit's own error, a missing Bukit and bad values", async () => {
    const failing = fakeBukit("fake-fail", true).service;
    await expect(
      bukitNewSite(failing, runnerOpts())(path.join(base, "failed"), { title: "x", language: "en" }),
    ).rejects.toMatchObject({
      code: "site.create_failed",
      status: 500,
      params: { detail: expect.stringContaining("boom") },
    });
    const missing = new BukitService({ dir: path.join(base, "no-bukit"), tmpDir: app.bukitTmp });
    await expect(
      bukitNewSite(missing, runnerOpts())(path.join(base, "missing"), { title: "x", language: "en" }),
    ).rejects.toMatchObject({ code: "build.bukit_missing", status: 409 });
    const ok = fakeBukit("fake-values").service;
    await expect(
      bukitNewSite(ok, runnerOpts())(path.join(base, "bad"), { title: "a\nb", language: "en" }),
    ).rejects.toMatchObject({ code: "request.invalid_body", status: 400 });
    expect(fs.existsSync(path.join(base, "bad"))).toBe(false);
  });
});

describe("writeSources", () => {
  it("replaces the content sources and keeps the rest of site.yaml", () => {
    const target = path.join(base, "sources");
    writeStarter(target, { title: "Sources", language: "en-US" });
    const before = parse(fs.readFileSync(path.join(target, "site.yaml"), "utf8"));
    const sources = [
      { type: "notion" as const, name: "notes", collection: "post", notion: { databaseId: "a".repeat(32) } },
    ];
    writeSources(target, sources);
    const after = parse(fs.readFileSync(path.join(target, "site.yaml"), "utf8"));
    expect(after.content.sources).toEqual(sources);
    expect({ ...after, content: { ...after.content, sources: null } }).toEqual({
      ...before,
      content: { ...before.content, sources: null },
    });
  });
});

describe("the bukit new stand-in (test/fixtures/starter)", () => {
  it("is a plain Bukit project with no BukitJalil files and no symlinks", () => {
    const files = listFiles(STARTER_FIXTURE);
    expect(files).toContain("site.yaml");
    expect(files).toContain("themes/starter/theme.yaml");
    expect(files).toContain("themes/starter/LICENSE");
    expect(files.filter((f) => /bukitjalil|\.bukit\/|^dist\//i.test(f))).toEqual([]);
    for (const f of files) expect(fs.lstatSync(path.join(STARTER_FIXTURE, f)).isFile()).toBe(true);
  });

  it("passes the pre-build guard once committed", async () => {
    const target = path.join(base, "guarded");
    writeStarter(target, { title: "Guarded", language: "zh-CN" });
    const id = { "user.name": "t", "user.email": "t@t" };
    await git.run(["init", "-q", "-b", "main"], { cwd: target, repoCheck: false });
    await git.run(["add", "-A"], { cwd: target });
    await git.run(["commit", "-q", "-m", "Initial site from BukitJalil starter"], { cwd: target, config: id });
    const commit = (await git.text(["rev-parse", "HEAD"], { cwd: target })).trim();
    expect(await guardCommit(git, target, commit)).toEqual({ ok: true, reasons: [], usesNotion: false });
  });

  it.skipIf(!REAL_BIN)("is what the bundled Bukit writes (regenerate it after raising BUKIT_VERSION)", async () => {
    const service = new BukitService({ dir: path.dirname(REAL_BIN as string), tmpDir: app.bukitTmp });
    const values = { title: ' Stand-in "site" ', language: "fr-CA" };
    const real = path.join(base, "real-new");
    const standIn = path.join(base, "stand-in-new");
    await bukitNewSite(service, runnerOpts())(real, values);
    writeStarter(standIn, values);
    const files = listFiles(real).sort();
    expect(listFiles(standIn).sort()).toEqual(files);
    for (const f of files) {
      expect(fs.readFileSync(path.join(standIn, f), "utf8"), f).toBe(fs.readFileSync(path.join(real, f), "utf8"));
    }
    expect(fs.readFileSync(path.join(real, "site.yaml"), "utf8")).not.toMatch(/\n\.\.\.\n$/);
  });
});

describe.skipIf(!REAL_BIN)("a site from the real bukit new", () => {
  it("has the Chinese theme text and builds, with the title escaped", async () => {
    const service = new BukitService({ dir: path.dirname(REAL_BIN as string), tmpDir: app.bukitTmp });
    const target = path.join(base, "real");
    await bukitNewSite(service, runnerOpts())(target, { title: "-真实构建 & <3", language: "zh-CN" });
    const yaml = parse(fs.readFileSync(path.join(target, "site.yaml"), "utf8"));
    expect(yaml.site).toMatchObject({ title: "-真实构建 & <3", languages: ["zh-CN"] });
    expect(yaml.content.media).toEqual({ onFailure: "keep" });
    expect(yaml.site.url).toBeUndefined();
    expect(yaml.theme.params).toMatchObject({ brand: "-真实构建 & <3", latest_heading: "最新文章" });
    expect(yaml.theme.params.labels).toMatchObject({ menu: "菜单", home: "首页" });

    const runner = new BukitRunner({ bukitPath: REAL_BIN as string, git, home: app.home, tmpDir: app.bukitTmp });
    expect(checkPassed(await runner.run("check", ["config", "check"], { cwd: target }))).toBe(true);
    expect(checkPassed(await runner.run("doctor", ["doctor"], { cwd: target }))).toBe(true);
    const out = ".bukitjalil-build/out";
    const build = await runner.run("build", ["build", "--output", out, "--base-url", "/", "--log-format", "json"], {
      cwd: target,
    });
    expect(buildOutcome(build)).toBe("ok");
    for (const page of ["index.html", "pages/about/index.html"]) {
      expect(fs.existsSync(path.join(target, out, page))).toBe(true);
    }
    const index = fs.readFileSync(path.join(target, out, "index.html"), "utf8");
    expect(/class="brand"[^>]*>([^<]*)</.exec(index)?.[1]?.trim()).toBe("-真实构建 &amp; &lt;3");
    expect(index).toContain("菜单");
  }, 120_000);
});
