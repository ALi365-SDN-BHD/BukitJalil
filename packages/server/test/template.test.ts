import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { guardCommit } from "../src/bukit/guard.ts";
import { BUKIT_VERSION } from "../src/bukit/install.ts";
import { BukitRunner, buildOutcome, checkPassed } from "../src/bukit/runner.ts";
import { GitRunner, resolveGitPath } from "../src/git/run.ts";
import { ensureAppHome } from "../src/paths.ts";
import { copyStarter, fillSiteYaml, siteSlug, validateStarterValues } from "../src/sites/template.ts";

const TEMPLATES = path.resolve(import.meta.dirname, "../../../templates");
const STARTER = path.join(TEMPLATES, "starter");
// Optional: the real Bukit, to build the template (plan M2: "用真实 Bukit 构建通过").
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

describe("templates/starter", () => {
  it("records its Bukit source", () => {
    const source = JSON.parse(fs.readFileSync(path.join(TEMPLATES, "starter.source.json"), "utf8"));
    expect(source).toMatchObject({ tag: `v${BUKIT_VERSION}`, license: "MIT" });
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("is a plain Bukit project with no BukitJalil files and no symlinks", () => {
    const files = listFiles(STARTER);
    expect(files).toContain("site.yaml");
    expect(files).toContain("themes/starter/theme.yaml");
    expect(files).toContain("themes/starter/LICENSE");
    expect(files.filter((f) => /bukitjalil|\.bukit\/|^dist\//i.test(f))).toEqual([]);
    for (const f of files) expect(fs.lstatSync(path.join(STARTER, f)).isFile()).toBe(true);
  });
});

describe("starter values", () => {
  it("validates the form values", () => {
    expect(validateStarterValues({ title: "My Site", language: "zh-CN" })).toBeNull();
    expect(validateStarterValues({ title: "  ", language: "en" })).toMatch(/title/);
    expect(validateStarterValues({ title: "a\nb", language: "en" })).toMatch(/control/);
    expect(validateStarterValues({ title: "x".repeat(201), language: "en" })).toMatch(/title/);
    expect(validateStarterValues({ title: "x", language: "en_US" })).toMatch(/language/);
    expect(validateStarterValues({ title: "x", language: "zh-Hant-TW" })).toBeNull();
  });

  it("derives site.name", () => {
    expect(siteSlug("My Café Blog!")).toBe("my-cafe-blog");
    expect(siteSlug("我的网站")).toBe("site");
    expect(siteSlug("  --A--  ")).toBe("a");
  });

  it("fills site.yaml and keeps the rest", () => {
    const text = fs.readFileSync(path.join(STARTER, "site.yaml"), "utf8");
    const filled = parse(fillSiteYaml(text, { title: '我的 "网站": 1', language: "zh-CN" }));
    const original = parse(text);
    expect(filled.site).toMatchObject({ name: "1", title: '我的 "网站": 1', language: "zh-CN" });
    expect(filled.theme.params).toMatchObject({ brand: '我的 "网站": 1', footer_text: '我的 "网站": 1' });
    expect(filled.content).toEqual(original.content);
    expect(filled.build).toEqual(original.build);
  });
});

describe("copyStarter", () => {
  it("copies into a new or empty directory only", () => {
    const target = path.join(base, "new", "site");
    copyStarter(STARTER, target, { title: "Demo", language: "en-US" });
    expect(listFiles(target).sort()).toEqual(listFiles(STARTER).sort());
    expect(parse(fs.readFileSync(path.join(target, "site.yaml"), "utf8")).site.title).toBe("Demo");

    expect(() => copyStarter(STARTER, target, { title: "Again", language: "en" })).toThrow(/empty/);
    const file = path.join(base, "a-file");
    fs.writeFileSync(file, "");
    expect(() => copyStarter(STARTER, file, { title: "x", language: "en" })).toThrow(/empty/);
    expect(() => copyStarter(STARTER, path.join(base, "bad"), { title: "", language: "en" })).toThrow(/title/);
    expect(fs.existsSync(path.join(base, "bad"))).toBe(false);
  });

  it("refuses a template with a symlink", () => {
    const tpl = path.join(base, "evil-template");
    fs.mkdirSync(tpl);
    fs.writeFileSync(path.join(tpl, "site.yaml"), "site:\n  title: x\n");
    fs.symlinkSync("/etc/passwd", path.join(tpl, "link"));
    expect(() => copyStarter(tpl, path.join(base, "evil-site"), { title: "x", language: "en" })).toThrow(/unexpected/);
  });

  it("passes the pre-build guard once committed", async () => {
    const target = path.join(base, "guarded");
    copyStarter(STARTER, target, { title: "Guarded", language: "zh-CN" });
    const id = { "user.name": "t", "user.email": "t@t" };
    await git.run(["init", "-q", "-b", "main"], { cwd: target, repoCheck: false });
    await git.run(["add", "-A"], { cwd: target });
    await git.run(["commit", "-q", "-m", "Initial site from BukitJalil starter"], { cwd: target, config: id });
    const commit = (await git.text(["rev-parse", "HEAD"], { cwd: target })).trim();
    expect(await guardCommit(git, target, commit)).toEqual({ ok: true, reasons: [], usesNotion: false });
  });

  it.skipIf(!REAL_BIN)(
    "builds with the real Bukit",
    async () => {
      const target = path.join(base, "real");
      copyStarter(STARTER, target, { title: "真实构建", language: "zh-CN" });
      const runner = new BukitRunner({ bukitPath: REAL_BIN as string, git, home: app.home, tmpDir: app.bukitTmp });
      expect(checkPassed(await runner.run("check", ["config", "check"], { cwd: target }))).toBe(true);
      expect(checkPassed(await runner.run("doctor", ["doctor"], { cwd: target }))).toBe(true);
      const out = ".bukitjalil-build/out";
      const build = await runner.run("build", ["build", "--output", out, "--base-url", "/", "--log-format", "json"], {
        cwd: target,
      });
      expect(buildOutcome(build)).toBe("ok");
      for (const page of ["index.html", "blog/2026/01/welcome/index.html", "pages/about/index.html"]) {
        expect(fs.existsSync(path.join(target, out, page))).toBe(true);
      }
      expect(fs.readFileSync(path.join(target, out, "index.html"), "utf8")).toContain("真实构建");
    },
    120_000,
  );
});
