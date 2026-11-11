import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkSiteConfig,
  guardCommit,
  hasFilterAttribute,
  PATH_FIELDS,
  pathProblem,
  routeProblem,
} from "../src/bukit/guard.ts";
import {
  BUKIT_VERSION,
  download,
  InstallError,
  installFiles,
  packageForPlatform,
  readStrictTarGz,
  verifySha256,
} from "../src/bukit/install.ts";
import { appBukitDir, BukitService, bukitInstaller, locateBukit, versionState } from "../src/bukit/locate.ts";
import { BukitRunner, buildOutcome, checkPassed, parseBukitVersion } from "../src/bukit/runner.ts";
import { GitRunner, resolveGitPath } from "../src/git/run.ts";
import { ensureAppHome } from "../src/paths.ts";
import { commitAllAs, makeApp, rawGit, req } from "./helpers.ts";
import { tarEntry, tgz } from "./tar.ts";

// Optional real-Bukit inputs: BUKIT_TARBALL (the official package for this platform) and BUKIT_BIN.
const REAL_TARBALL = process.env.BUKIT_TARBALL;
const REAL_BIN = process.env.BUKIT_BIN;

const gitPath = resolveGitPath();
if (!gitPath) throw new Error("git is required for these tests");

let base: string;
let git: GitRunner;
let appHome: string;
let tmpDir: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-bukit-")));
  const app = ensureAppHome(path.join(base, "app"));
  appHome = app.home;
  tmpDir = app.bukitTmp;
  git = new GitRunner({ gitPath, home: app.home, emptyFile: app.emptyGitConfig, hooksDir: app.emptyHooks });
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

/** A shell script standing in for bukit. */
function fakeBukit(name: string, body: string): string {
  const file = path.join(base, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

// --- site.yaml guard ---

describe("checkSiteConfig", () => {
  const codes = (yaml: string) => checkSiteConfig(yaml).reasons.map((r) => `${r.code}@${r.where}`);

  it("accepts an ordinary config", () => {
    const yaml = `site:
  title: Demo
  plugins:
    sitemap: true
    feed: { enabled: true }
  permalinks:
    posts: /posts/{slug}/
content:
  sources:
    - type: markdown
      markdown: { dir: content, includeGlobs: ["**/*.md"] }
  media: { downloadDir: assets/media, blockPrivateNetworks: true }
build: { output: dist }
theme: { name: starter, layouts: themes/starter/layouts }
`;
    expect(checkSiteConfig(yaml)).toEqual({ reasons: [], usesNotion: false });
  });

  it.each([
    ["/etc", "absolute path"],
    ["~/x", "absolute path"],
    ["C:/x", "absolute path"],
    ["a/../../x", "contains .."],
    ["..", "contains .."],
    ["a\\b", "contains a backslash"],
    ["file:///etc", "URL"],
  ])("rejects path %s", (value, problem) => {
    expect(pathProblem(value)).toBe(problem);
  });

  it("checks every path field, including map keys and array items", () => {
    const yaml = `content:
  media: { downloadDir: /tmp/x }
  sources:
    - markdown: { dir: ../outside, includePaths: [ok, /abs], includeGlobs: ["../**"] }
    - notion: { cacheDir: ~/cache }
build: { output: ../../dist }
theme:
  name: a/b
  layouts: /l
  assets: ../a
  static: /s
  staticTemplate: ../t
  shortcodes: { note: /n.html }
  components: { card: { template: ../c.html } }
  scss: { entryPoint: /e.scss, outputDir: ../o }
site:
  collections:
    posts:
      template: /t
      listTemplate: ../l
      output: { archiveDetail: { template: /a } }
      filteredLists: [{ listTemplate: ../f }]
taxonomy:
  kinds: [{ template: /t, indexTemplate: ../i, termTemplate: /x }]
`;
    const found = new Set(
      checkSiteConfig(yaml)
        .reasons.filter((r) => r.code === "unsafe_path")
        .map((r) => r.where),
    );
    const expected = [
      "content.media.downloadDir",
      "content.sources[0].markdown.dir",
      "content.sources[0].markdown.includePaths[1]",
      "content.sources[0].markdown.includeGlobs[0]",
      "content.sources[1].notion.cacheDir",
      "build.output",
      "theme.name",
      "theme.layouts",
      "theme.assets",
      "theme.static",
      "theme.staticTemplate",
      "theme.shortcodes.note",
      "theme.components.card.template",
      "theme.scss.entryPoint",
      "theme.scss.outputDir",
      "site.collections.posts.template",
      "site.collections.posts.listTemplate",
      "site.collections.posts.output.archiveDetail.template",
      "site.collections.posts.filteredLists[0].listTemplate",
      "taxonomy.kinds[0].template",
      "taxonomy.kinds[0].indexTemplate",
      "taxonomy.kinds[0].termTemplate",
    ];
    expect([...found].sort()).toEqual([...expected].sort());
    expect(expected.length).toBe(PATH_FIELDS.length);
  });

  it("allows leading / in routes but not ..", () => {
    expect(routeProblem("/posts/{slug}/")).toBeNull();
    expect(codes('site:\n  feed: { path: /../../x.xml }\n  permalinks: { page: "/{slug}/" }\n')).toEqual([
      "unsafe_route@site.feed.path",
    ]);
  });

  it("rejects plugins that are not built in", () => {
    expect(codes("site:\n  plugins:\n    sitemap: true\n    indexnow: { enabled: true }\n")).toEqual([
      "unknown_plugin@site.plugins.indexnow",
    ]);
  });

  it.each(["false", '"false"', "'False'", " FALSE "])("treats blockPrivateNetworks: %s as off, like Bukit", (v) => {
    expect(codes(`content:\n  media:\n    blockPrivateNetworks: ${v}\n`)).toEqual([
      "private_network_allowed@content.media.blockPrivateNetworks",
    ]);
  });

  it("keeps blockPrivateNetworks: no / 0 (not .NET booleans) as allowed values", () => {
    expect(codes("content:\n  media:\n    blockPrivateNetworks: true\n")).toEqual([]);
  });

  it("follows aliases into path fields", () => {
    expect(codes("x: &p /etc\nbuild:\n  output: *p\n")).toEqual(["unsafe_path@build.output"]);
  });

  it("rejects invalid YAML, duplicate keys and non-mappings", () => {
    expect(codes("site: [\n")[0]).toMatch(/^invalid_site_yaml/);
    expect(codes("build: { output: dist }\nbuild: { output: /etc }\n")[0]).toMatch(/^invalid_site_yaml/);
    expect(codes("- a\n")[0]).toMatch(/^invalid_site_yaml/);
  });

  it("detects Notion sources", () => {
    expect(checkSiteConfig("content:\n  sources:\n    - type: notion\n").usesNotion).toBe(true);
    expect(checkSiteConfig("content:\n  sources:\n    - notion: { databaseId: x }\n").usesNotion).toBe(true);
  });
});

// --- guard on git objects ---

const raw = (cwd: string, ...args: string[]) => rawGit(base, cwd, ...args);

function siteRepo(name: string, files: Record<string, string>, symlinks: Record<string, string> = {}): string {
  const dir = path.join(base, name);
  fs.mkdirSync(dir);
  raw(dir, "init", "-q", "-b", "main");
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  for (const [link, target] of Object.entries(symlinks)) fs.symlinkSync(target, path.join(dir, link));
  commitAllAs(base, dir);
  return dir;
}
/** A repository whose commit is built from blobs directly, so paths may collide on this file system. */
function treeRepo(name: string, files: Record<string, string>): string {
  const dir = path.join(base, name);
  fs.mkdirSync(dir);
  raw(dir, "init", "-q", "-b", "main");
  for (const [file, content] of Object.entries(files)) {
    const blob = path.join(base, `${name}-blob`);
    fs.writeFileSync(blob, content);
    const oid = raw(dir, "hash-object", "-w", blob).trim();
    raw(dir, "update-index", "--add", "--cacheinfo", `100644,${oid},${file}`);
  }
  const tree = raw(dir, "write-tree").trim();
  const commit = raw(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", tree, "-m", "init").trim();
  raw(dir, "update-ref", "refs/heads/main", commit);
  return dir;
}
const head = (dir: string) => raw(dir, "rev-parse", "HEAD").trim();

describe("guardCommit", () => {
  const SITE = "site:\n  title: x\nbuild:\n  output: dist\n";

  it("passes a clean site", async () => {
    const dir = siteRepo("clean", { "site.yaml": SITE, "content/a.md": "# a\n" });
    expect(await guardCommit(git, dir, head(dir))).toEqual({ ok: true, reasons: [], usesNotion: false });
  });

  it("rejects symlinks, plugin files and LFS", async () => {
    const dir = siteRepo(
      "evil",
      {
        "site.yaml": SITE,
        "plugins/x/plugin.yaml": "id: x\n",
        ".bukit/plugins.yaml": "x: 1\n",
        "themes/t/plugin.yaml": "id: y\n",
        "content/.gitattributes": "*.png filter=lfs diff=lfs\n",
      },
      { "content/link.md": "/etc/passwd" },
    );
    const result = await guardCommit(git, dir, head(dir));
    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => `${r.code}@${r.where}`).sort()).toEqual(
      [
        "lfs@content/.gitattributes",
        "plugin_files@.bukit/plugins.yaml",
        "plugin_files@plugins/x/plugin.yaml",
        "plugin_files@themes/t/plugin.yaml",
        "symlink@content/link.md",
      ].sort(),
    );
  });

  it("compares names case-insensitively and refuses case collisions", async () => {
    const dir = treeRepo("case", {
      "site.yaml": SITE,
      "SITE.yaml": "build:\n  output: /etc\n",
      "Plugins/x/PLUGIN.YAML": "id: x\n",
      ".BUKIT/Plugins.yaml": "x: 1\n",
    });
    const codes = (await guardCommit(git, dir, head(dir))).reasons.map((r) => `${r.code}@${r.where}`).sort();
    expect(codes).toEqual(
      ["case_collision@site.yaml", "plugin_files@.BUKIT/Plugins.yaml", "plugin_files@Plugins/x/PLUGIN.YAML"].sort(),
    );
    // JavaScript's toLowerCase leaves "ſ" (U+017F) alone, but APFS folds it to "s": the second file would
    // land on site.yaml at checkout.
    const folded = treeRepo("fold", { "site.yaml": SITE, "\u017fite.yaml": "theme:\n  static: /etc\n" });
    expect((await guardCommit(git, folded, head(folded))).reasons.map((r) => r.code)).toContain("case_collision");
    const upper = siteRepo("upper", { "Site.yaml": SITE });
    expect((await guardCommit(git, upper, head(upper))).reasons.map((r) => r.code)).toEqual(["missing_site_yaml"]);
  });

  it("refuses files too large to check instead of skipping them", async () => {
    const big = siteRepo("bigattrs", { "site.yaml": SITE, ".gitattributes": `${"#".repeat(300 * 1024)}\n` });
    expect((await guardCommit(git, big, head(big))).reasons).toEqual([
      { code: "lfs", where: ".gitattributes", detail: `larger than ${256 * 1024} bytes` },
    ]);
    const bigSite = siteRepo("bigsite", { "site.yaml": `# ${"x".repeat(1024 * 1024)}\n${SITE}` });
    expect((await guardCommit(git, bigSite, head(bigSite))).reasons.map((r) => r.code)).toEqual(["invalid_site_yaml"]);
  });

  it("ignores filter= in comments", () => {
    expect(hasFilterAttribute("# *.png filter=lfs\n*.md diff=markdown\n")).toBe(false);
    expect(hasFilterAttribute("*.png  filter=lfs -text\n")).toBe(true);
    expect(hasFilterAttribute("[attr]big filter=lfs\n")).toBe(true);
  });

  it("reports a missing or symlinked site.yaml", async () => {
    const none = siteRepo("nosite", { "a.md": "a\n" });
    expect((await guardCommit(git, none, head(none))).reasons.map((r) => r.code)).toEqual(["missing_site_yaml"]);
    const linked = siteRepo("linksite", { "real.yaml": SITE }, { "site.yaml": "real.yaml" });
    expect((await guardCommit(git, linked, head(linked))).reasons.map((r) => r.code).sort()).toEqual([
      "missing_site_yaml",
      "symlink",
    ]);
  });

  it("judges the commit, not the working tree", async () => {
    const dir = siteRepo("worktree", { "site.yaml": "build:\n  output: /etc\n" });
    const commit = head(dir);
    fs.writeFileSync(path.join(dir, "site.yaml"), SITE); // a clean working tree does not hide the commit
    expect((await guardCommit(git, dir, commit)).reasons.map((r) => r.code)).toEqual(["unsafe_path"]);

    const ok = siteRepo("worktree-ok", { "site.yaml": SITE });
    fs.writeFileSync(path.join(ok, "site.yaml"), "build:\n  output: /etc\n");
    fs.symlinkSync("/etc/passwd", path.join(ok, "untracked-link"));
    expect((await guardCommit(git, ok, head(ok))).ok).toBe(true);
  });

  it("refuses an unsafe repository before reading anything", async () => {
    const dir = siteRepo("hostile", { "site.yaml": SITE });
    raw(dir, "config", "core.fsmonitor", "/bin/false");
    await expect(guardCommit(git, dir, head(dir))).rejects.toMatchObject({ kind: "unsafe_repo" });
  });
});

// --- runner ---

describe("BukitRunner", () => {
  it("runs with a minimal environment and git hardening", async () => {
    process.env.BJ_TEST_SECRET = "leak";
    try {
      const bin = fakeBukit("env-bukit", 'env; echo "args:$*"; exit 3');
      const runner = new BukitRunner({ bukitPath: bin, git, home: appHome, tmpDir });
      const result = await runner.run("build", ["build", "--out", "a b"], { cwd: base, env: { NOTION_TOKEN: "n" } });
      expect(result.exitCode).toBe(3);
      expect(buildOutcome(result)).toBe("render_error");
      expect(result.stdout).toContain("args:build --out a b");
      expect(result.stdout).not.toContain("BJ_TEST_SECRET");
      const env = Object.fromEntries(
        result.stdout
          .split("\n")
          .filter((l) => l.includes("="))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      );
      expect(env.PATH?.split(":").slice(1)).toEqual(["/usr/bin", "/bin"]);
      expect(env.TMPDIR).toBe(tmpDir);
      expect(env.HOME).toBe(appHome);
      expect(env.NOTION_TOKEN).toBe("n");
      expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
      expect(Number(env.GIT_CONFIG_COUNT)).toBeGreaterThan(0);
    } finally {
      delete process.env.BJ_TEST_SECRET;
    }
  });

  it("stops on timeout with SIGINT first", async () => {
    const bin = fakeBukit("slow-bukit", "trap 'echo got-int; exit 130' INT\nwhile true; do sleep 0.05; done");
    const runner = new BukitRunner({ bukitPath: bin, git, home: appHome, tmpDir });
    // Long enough for the shell to set its trap even on a busy machine (300 ms was not under a full run).
    const result = await runner.run("check", [], { cwd: base, timeoutMs: 1500 });
    expect(result.stopped).toBe("timeout");
    expect(result.stdout).toContain("got-int");
    expect(checkPassed(result)).toBe(false);
    expect(buildOutcome(result)).toBe("stopped");
  });

  it("puts only git on the private PATH and accepts only known secrets", async () => {
    const bin = fakeBukit("path-bukit", 'echo "PATH=$PATH"; echo "X=$EVIL"; command -v git; ls "${PATH%%:*}"');
    const runner = new BukitRunner({ bukitPath: bin, git, home: appHome, tmpDir });
    const fs2 = path.join(runner.binDir, "stray");
    fs.mkdirSync(runner.binDir, { recursive: true });
    fs.writeFileSync(fs2, "x");
    const secrets = { NOTION_TOKEN: "n", PATH: "/opt/evil", EVIL: "1" } as unknown as { NOTION_TOKEN: string };
    const result = await runner.run("build", [], { cwd: base, env: secrets });
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe(`PATH=${runner.binDir}:/usr/bin:/bin`);
    expect(lines[1]).toBe("X=");
    expect(lines[2]).toBe(path.join(runner.binDir, "git"));
    expect(lines.slice(3)).toEqual(["git"]);
    expect(fs.readlinkSync(path.join(runner.binDir, "git"))).toBe(gitPath);
    expect(runner.env({ NOTION_TOKEN: "n" }).NOTION_TOKEN).toBe("n");
  });

  it("keeps multibyte characters split across output chunks", async () => {
    // "构建" is e6 9e 84 e5 bb ba; the pause splits the first character between two reads.
    const bin = fakeBukit("utf8-bukit", "printf '\\346\\236'; sleep 0.2; printf '\\204\\345\\273\\272\\n' >&1");
    const runner = new BukitRunner({ bukitPath: bin, git, home: appHome, tmpDir });
    expect((await runner.run("build", [], { cwd: base })).stdout).toBe("构建\n");
  });

  it("stops on abort", async () => {
    const bin = fakeBukit("abort-bukit", "trap 'exit 130' INT\nwhile true; do sleep 0.05; done");
    const runner = new BukitRunner({ bukitPath: bin, git, home: appHome, tmpDir });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    expect((await runner.run("build", [], { cwd: base, signal: ac.signal })).stopped).toBe("aborted");
  });

  it("interprets exit codes and output", () => {
    const r = (exitCode: number) => ({ exitCode, stdout: "", stderr: "", durationMs: 0, stopped: null });
    expect([0, 2, 3, 1].map((c) => buildOutcome(r(c)))).toEqual([
      "ok",
      "config_or_content_error",
      "render_error",
      "failed",
    ]);
    expect(checkPassed(r(0))).toBe(true);
    expect(checkPassed(r(2))).toBe(false);
    expect(parseBukitVersion("bukit 2.0.11+9006a2bd42290abea01f0e519607344983d9dd87\n")).toBe("2.0.11");
    expect(parseBukitVersion("nope")).toBeNull();
  });
});

// --- install ---

/** One ustar entry. */
const FILES = ["bukit", "libSkiaSharp.dylib"];
const good = () => [
  tarEntry("./", "", "5"),
  tarEntry("./bukit", "#!bin"),
  tarEntry("./libSkiaSharp.dylib", "lib", "0", 0o744),
];

describe("readStrictTarGz", () => {
  it("reads the expected layout", () => {
    const files = readStrictTarGz(tgz(...good()), FILES);
    expect([...files.keys()]).toEqual(FILES);
    expect(files.get("bukit")?.data.toString()).toBe("#!bin");
  });

  it.each([
    ["an extra file", [...good(), tarEntry("./evil", "x")]],
    ["a symlink", [tarEntry("./bukit", "", "2"), tarEntry("./libSkiaSharp.dylib", "lib")]],
    ["a hard link", [...good().slice(0, 2), tarEntry("./libSkiaSharp.dylib", "", "1")]],
    ["a pax header", [tarEntry("./PaxHeaders/bukit", "30 path=../../x\n", "x"), ...good()]],
    ["a GNU long name", [tarEntry("././@LongLink", "../x", "L"), ...good()]],
    ["a parent path", [tarEntry("../bukit", "x"), tarEntry("./libSkiaSharp.dylib", "lib")]],
    ["a prefix parent path", [tarEntry("bukit", "x", "0", 0o755, ".."), tarEntry("./libSkiaSharp.dylib", "lib")]],
    ["an absolute path", [tarEntry("/bukit", "x"), tarEntry("./libSkiaSharp.dylib", "lib")]],
    ["a subdirectory", [tarEntry("./sub/", "", "5"), ...good()]],
    ["a nested file", [tarEntry("./sub/bukit", "x"), tarEntry("./libSkiaSharp.dylib", "lib")]],
    ["a duplicate", [...good(), tarEntry("./bukit", "again")]],
    ["a missing file", good().slice(0, 2)],
    ["a device", [tarEntry("./bukit", "", "3"), tarEntry("./libSkiaSharp.dylib", "lib")]],
  ])("rejects %s", (_name, entries) => {
    expect(() => readStrictTarGz(tgz(...entries), FILES)).toThrow(InstallError);
  });

  it("rejects corrupt archives", () => {
    const entry = tarEntry("./bukit", "x");
    entry[0] = entry[0] === 0x2e ? 0x2f : 0x2e; // break the header checksum
    expect(() => readStrictTarGz(tgz(entry), FILES)).toThrow(/checksum/);
    expect(() => readStrictTarGz(Buffer.from("not gzip"), FILES)).toThrow(/decompress/);
    const truncated = Buffer.concat(good()).subarray(0, 600);
    expect(() => readStrictTarGz(zlib.gzipSync(truncated), FILES)).toThrow(InstallError);
  });

  it.skipIf(!REAL_TARBALL)("reads the official package", () => {
    const data = fs.readFileSync(REAL_TARBALL as string);
    const pkg = packageForPlatform();
    if (!pkg) return;
    verifySha256(data, pkg.sha256);
    expect([...readStrictTarGz(data, pkg.files).keys()].sort()).toEqual([...pkg.files].sort());
  });
});

describe("install steps", () => {
  it("checks SHA-256", () => {
    const data = Buffer.from("abc");
    verifySha256(data, crypto.createHash("sha256").update(data).digest("hex"));
    expect(() => verifySha256(data, "0".repeat(64))).toThrow(/mismatch/);
  });

  it("installs into place with fixed modes and replaces an old copy", () => {
    const target = path.join(base, "inst", "bukit-x");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "stale"), "old");
    installFiles(readStrictTarGz(tgz(...good()), FILES), target, "bukit");
    expect(fs.readdirSync(target).sort()).toEqual(FILES);
    expect(fs.statSync(path.join(target, "bukit")).mode & 0o777).toBe(0o755);
    expect(fs.statSync(path.join(target, "libSkiaSharp.dylib")).mode & 0o777).toBe(0o644);
    expect(fs.readdirSync(path.dirname(target)).filter((n) => n.startsWith(".staging"))).toEqual([]);
  });

  it("caps the download size", async () => {
    const big = async () => new Response("x", { headers: { "content-length": String(500 * 1024 * 1024) } });
    await expect(download("https://example.invalid/x", () => {}, big as typeof fetch)).rejects.toMatchObject({
      code: "too_large",
    });
    const notFound = async () => new Response("no", { status: 404 });
    await expect(download("https://example.invalid/x", () => {}, notFound as typeof fetch)).rejects.toMatchObject({
      code: "download_failed",
    });
  });

  it("gives up on a stalled download", async () => {
    const stalled = (async (_url: string, init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(5));
            init?.signal?.addEventListener("abort", () => c.error(new Error("aborted")));
          },
        }),
      )) as typeof fetch;
    await expect(download("https://example.invalid/x", () => {}, stalled, { stallMs: 100 })).rejects.toMatchObject({
      code: "download_failed",
      message: "no data received",
    });
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_r, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      )) as typeof fetch;
    await expect(download("https://example.invalid/x", () => {}, hanging, { stallMs: 100 })).rejects.toMatchObject({
      code: "download_failed",
      message: "no data received",
    });
  });

  it("reports progress", async () => {
    const seen: number[] = [];
    const ok = async () => new Response(Buffer.alloc(10), { headers: { "content-length": "10" } });
    const data = await download("https://example.invalid/x", (r) => seen.push(r), ok as typeof fetch);
    expect(data.length).toBe(10);
    expect(seen.at(-1)).toBe(10);
  });
});

describe("bukitInstaller", () => {
  it("fails on an unsupported platform", async () => {
    const inst = bukitInstaller({ home: path.join(base, "i1"), tmpDir, platform: "darwin", arch: "x64" });
    inst.start();
    await inst.wait();
    expect(inst.progress).toMatchObject({ state: "failed", code: "unsupported_platform" });
  });

  it("refuses a package with the wrong checksum and installs nothing", async () => {
    const home = path.join(base, "i2");
    const fetchImpl = (async () => new Response(tgz(...good()))) as typeof fetch;
    const inst = bukitInstaller({ home, tmpDir, fetchImpl, platform: "darwin", arch: "arm64" });
    expect(inst.start()).toBe(true);
    expect(inst.start()).toBe(false);
    await inst.wait();
    expect(inst.progress).toMatchObject({ state: "failed", code: "checksum_mismatch" });
    expect(fs.existsSync(appBukitDir(home))).toBe(false);
  });

  it.skipIf(!REAL_TARBALL || !packageForPlatform())("reports a local write failure as install_failed", async () => {
    const home = path.join(base, "i4");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, "bin"), "not a directory");
    const data = fs.readFileSync(REAL_TARBALL as string);
    const inst = bukitInstaller({ home, tmpDir, fetchImpl: (async () => new Response(data)) as typeof fetch });
    inst.start();
    await inst.wait();
    expect(inst.progress).toMatchObject({ state: "failed", code: "install_failed" });
  });

  it.skipIf(!REAL_TARBALL || !packageForPlatform())(
    "installs the official package and checks its version",
    async () => {
      const home = path.join(base, "i3");
      const data = fs.readFileSync(REAL_TARBALL as string);
      const fetchImpl = (async () =>
        new Response(data, { headers: { "content-length": String(data.length) } })) as typeof fetch;
      // An earlier app install is replaced by the upgrade.
      const previous = appBukitDir(home, "2.0.11");
      fs.mkdirSync(previous, { recursive: true });
      fs.writeFileSync(path.join(previous, "bukit"), '#!/bin/sh\necho "bukit 2.0.11"\n', { mode: 0o755 });
      const inst = bukitInstaller({ home, tmpDir, fetchImpl });
      inst.start();
      await inst.wait();
      expect(inst.progress).toEqual({ state: "done" });
      const status = await locateBukit({ customPath: null, home, tmpDir, envPath: "" });
      expect(status).toMatchObject({ source: "app", version: BUKIT_VERSION, state: "ok", upgradable: false });
      expect(fs.existsSync(previous)).toBe(false);
    },
    60_000,
  );
});

// --- locate ---

describe("locateBukit", () => {
  const home = () => path.join(base, "no-app-home");

  it("reports missing", async () => {
    expect(await locateBukit({ customPath: null, home: home(), tmpDir, envPath: "" })).toMatchObject({
      path: null,
      state: "missing",
      customProblem: null,
    });
  });

  it("prefers the custom path and grades versions", async () => {
    const v = (ver: string) => fakeBukit(`v-${ver}`, `echo "bukit ${ver}+abc"`);
    for (const [ver, state] of [
      ["2.0.11", "ok"],
      ["2.0.12", "ok"],
      ["2.0.9", "old"],
      ["2.1.0", "unsupported"],
      ["1.9.0", "unsupported"],
    ] as const) {
      expect(await locateBukit({ customPath: v(ver), home: home(), tmpDir, envPath: "" })).toMatchObject({
        source: "custom",
        version: ver,
        state,
      });
    }
    expect(versionState("2.0.10")).toBe("old");
  });

  it("falls back from a bad custom path to the app copy, then PATH", async () => {
    const appHome2 = path.join(base, "app2");
    fs.mkdirSync(appBukitDir(appHome2), { recursive: true });
    fs.writeFileSync(path.join(appBukitDir(appHome2), "bukit"), '#!/bin/sh\necho "bukit 2.0.11"\n', { mode: 0o755 });
    const broken = fakeBukit("broken", "exit 1");
    expect(await locateBukit({ customPath: "relative/bukit", home: appHome2, tmpDir, envPath: "" })).toMatchObject({
      source: "app",
      customProblem: "not_found",
    });
    expect(await locateBukit({ customPath: broken, home: appHome2, tmpDir, envPath: "" })).toMatchObject({
      source: "app",
      customProblem: "broken",
    });

    const pathDir = path.join(base, "pathdir");
    fs.mkdirSync(pathDir);
    fs.writeFileSync(path.join(pathDir, "bukit"), '#!/bin/sh\necho "bukit 2.0.11"\n', { mode: 0o755 });
    expect(await locateBukit({ customPath: null, home: home(), tmpDir, envPath: `relative:${pathDir}` })).toMatchObject(
      {
        source: "path",
        path: path.join(pathDir, "bukit"),
      },
    );
  });

  it("still uses an earlier app install (2.0.11) and offers the upgrade, never a downgrade", async () => {
    const appHome3 = path.join(base, "app3");
    const previous = appBukitDir(appHome3, "2.0.11");
    fs.mkdirSync(previous, { recursive: true });
    fs.writeFileSync(path.join(previous, "bukit"), '#!/bin/sh\necho "bukit 2.0.11"\n', { mode: 0o755 });
    expect(await locateBukit({ customPath: null, home: appHome3, tmpDir, envPath: "" })).toMatchObject({
      source: "app",
      path: path.join(previous, "bukit"),
      version: "2.0.11",
      state: "ok",
      upgradable: packageForPlatform() !== null,
    });
    expect(BUKIT_VERSION).toBe("2.0.12");
    // A newer Bukit on PATH is not "upgraded" to the pinned one.
    const newer = path.join(base, "newer-path");
    fs.mkdirSync(newer);
    fs.writeFileSync(path.join(newer, "bukit"), '#!/bin/sh\necho "bukit 2.0.13"\n', { mode: 0o755 });
    expect(await locateBukit({ customPath: null, home: home(), tmpDir, envPath: newer })).toMatchObject({
      source: "path",
      state: "ok",
      upgradable: false,
    });
  });

  it("does not cache a failed lookup", async () => {
    const pathDir = path.join(base, "cachedir");
    fs.mkdirSync(pathDir);
    fs.writeFileSync(path.join(pathDir, "bukit"), '#!/bin/sh\necho "bukit 2.0.11"\n', { mode: 0o755 });
    const badTmp = path.join(base, "tmp-is-a-file");
    fs.writeFileSync(badTmp, "");
    const service = new BukitService({ home: home(), tmpDir: badTmp, customPath: () => null, envPath: pathDir });
    await expect(service.status()).rejects.toThrow();
    fs.rmSync(badTmp);
    expect(await service.status()).toMatchObject({ source: "path", state: "ok" });
  });

  it("reports a found but broken bukit", async () => {
    const pathDir = path.join(base, "brokendir");
    fs.mkdirSync(pathDir);
    fs.writeFileSync(path.join(pathDir, "bukit"), "#!/bin/sh\nexit 2\n", { mode: 0o755 });
    expect(await locateBukit({ customPath: null, home: home(), tmpDir, envPath: pathDir })).toMatchObject({
      source: "path",
      state: "broken",
      version: null,
    });
  });

  it.skipIf(!REAL_BIN)("runs the real bukit version", async () => {
    expect(await locateBukit({ customPath: REAL_BIN as string, home: home(), tmpDir, envPath: "" })).toMatchObject({
      source: "custom",
      version: BUKIT_VERSION,
      state: "ok",
    });
  });
});

// --- API ---

describe("/api/bukit", () => {
  const post = () =>
    req("/api/bukit/install", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: "http://127.0.0.1:47880" },
    });

  it("reports status and install progress; one install at a time", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fetchImpl = (async () => {
      await gate;
      return new Response("not a package");
    }) as typeof fetch;
    const bukit = new BukitService({
      home: path.join(base, "api"),
      tmpDir,
      customPath: () => null,
      envPath: "",
      fetchImpl,
    });
    const { app } = makeApp({ bukit });

    const first = (await (await app.fetch(req("/api/bukit"))).json()) as {
      status: { state: string };
      install: unknown;
    };
    expect(first.status.state).toBe("missing");
    expect(first.install).toEqual({ state: "idle" });

    if (!packageForPlatform()) {
      expect((await app.fetch(post())).status).toBe(400);
      return;
    }
    expect((await app.fetch(post())).status).toBe(202);
    const again = await app.fetch(post());
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ code: "bukit.install_running" });
    release();
    await bukit.installer.wait();
    const after = (await (await app.fetch(req("/api/bukit"))).json()) as { install: { state: string; code?: string } };
    expect(after.install).toMatchObject({ state: "failed", code: "checksum_mismatch" });
  });

  it("re-locates after the custom path changes", async () => {
    const bukit = new BukitService({
      home: path.join(base, "api2"),
      tmpDir,
      customPath: () => custom,
      envPath: "",
    });
    let custom: string | null = null;
    const { app, db } = makeApp({ bukit });
    expect((await bukit.status()).state).toBe("missing");
    const bin = fakeBukit("api-bukit", 'echo "bukit 2.0.11"');
    const res = await app.fetch(
      req("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ bukitPath: bin }),
        headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: "http://127.0.0.1:47880" },
      }),
    );
    expect(res.status).toBe(200);
    custom = bin;
    const body = (await (await app.fetch(req("/api/bukit"))).json()) as { status: unknown };
    expect(body.status).toMatchObject({ source: "custom", state: "ok" });
    db.close();
  });

  it("rejects a relative custom path", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      req("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ bukitPath: "bin/bukit" }),
        headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: "http://127.0.0.1:47880" },
      }),
    );
    expect(res.status).toBe(400);
  });
});
