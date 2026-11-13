import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchBukit, latestBukitRelease } from "../src/bukit/fetch.ts";
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
  type BukitPackage,
  download,
  InstallError,
  installFiles,
  PACKAGES,
  packageForPlatform,
  readPackage,
  readStrictTarGz,
  readStrictZip,
  verifySha256,
} from "../src/bukit/install.ts";
import { BukitService, devBukitDir, locateBukit, removeOldAppCopies, versionState } from "../src/bukit/locate.ts";
import { BukitRunner, buildOutcome, checkPassed, parseBukitVersion } from "../src/bukit/runner.ts";
import { GitRunner, resolveGitPath } from "../src/git/run.ts";
import { ensureAppHome, resolveResources } from "../src/paths.ts";
import { commitAllAs, installAppBukit, makeApp, rawGit, req, testBukitDir } from "./helpers.ts";
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

  it("accepts built-in plugin names in any case, like Bukit", () => {
    expect(codes("site:\n  plugins:\n    Analytics: false\n    Related-Content: false\n")).toEqual([]);
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

const ZIP_FILES = ["bukit.exe", "libSkiaSharp.dll"];

describe("readStrictZip", () => {
  it("reads the Windows layout", () => {
    const files = readStrictZip(
      Buffer.from(
        zipSync({
          "bukit.exe": new Uint8Array([1, 2]),
          "libSkiaSharp.dll": new Uint8Array([3]),
        }),
      ),
      ZIP_FILES,
    );
    expect([...files.keys()].sort()).toEqual([...ZIP_FILES].sort());
    expect(files.get("bukit.exe")?.data).toEqual(Buffer.from([1, 2]));
  });

  it("rejects extra, nested and missing files", () => {
    const extra = zipSync({
      "bukit.exe": new Uint8Array(),
      "libSkiaSharp.dll": new Uint8Array(),
      evil: new Uint8Array(),
    });
    expect(() => readStrictZip(Buffer.from(extra), ZIP_FILES)).toThrow(InstallError);
    const nested = zipSync({ "sub/bukit.exe": new Uint8Array(), "libSkiaSharp.dll": new Uint8Array() });
    expect(() => readStrictZip(Buffer.from(nested), ZIP_FILES)).toThrow(InstallError);
    const missing = zipSync({ "bukit.exe": new Uint8Array() });
    expect(() => readStrictZip(Buffer.from(missing), ZIP_FILES)).toThrow(InstallError);
  });
});

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

describe("fetchBukit (packaging, plan 8.1)", () => {
  const pkgOf = (data: Buffer, file = "bukit-test.tar.gz"): BukitPackage => ({
    file,
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
    files: ["bukit", "libSkiaSharp.dylib"],
    executable: "bukit",
  });
  const fakePackage = (printed: string) =>
    tgz(
      tarEntry("./", "", "5"),
      tarEntry("./bukit", `#!/bin/sh\necho "bukit ${printed}"\n`),
      tarEntry("./libSkiaSharp.dylib", "lib"),
    );
  const serve = (data: Buffer) => (async () => new Response(data)) as typeof fetch;

  it("installs a checked package readable by everyone and keeps the package when asked", async () => {
    const dir = path.join(base, "fetch-ok");
    const data = fakePackage("2.0.15");
    const { bin, tarball } = await fetchBukit({
      dir,
      pkg: pkgOf(data),
      url: "https://example.invalid/p",
      version: "2.0.15",
      keepPackage: true,
      fetchImpl: serve(data),
    });
    expect(bin).toBe(path.join(dir, "bukit-2.0.15", "bukit"));
    expect(fs.statSync(path.dirname(bin)).mode & 0o777).toBe(0o755);
    expect(fs.statSync(bin).mode & 0o777).toBe(0o755);
    expect(tarball && fs.readFileSync(tarball).equals(data)).toBe(true);
  });

  it("installs nothing when the checksum does not match", async () => {
    const dir = path.join(base, "fetch-sum");
    const data = fakePackage("2.0.15");
    const pkg = { ...pkgOf(data), sha256: "0".repeat(64) };
    await expect(
      fetchBukit({ dir, pkg, url: "https://example.invalid/p", version: "2.0.15", fetchImpl: serve(data) }),
    ).rejects.toMatchObject({ code: "checksum_mismatch" });
    expect(fs.existsSync(path.join(dir, "bukit-2.0.15"))).toBe(false);
  });

  it("removes the copy when bukit version prints another version", async () => {
    const dir = path.join(base, "fetch-ver");
    const data = fakePackage("2.0.14");
    await expect(
      fetchBukit({
        dir,
        pkg: pkgOf(data),
        url: "https://example.invalid/p",
        version: "2.0.15",
        fetchImpl: serve(data),
      }),
    ).rejects.toMatchObject({ code: "verify_failed" });
    expect(fs.existsSync(path.join(dir, "bukit-2.0.15"))).toBe(false);
  });

  it("pins a SHA-256 for every official package", () => {
    for (const pkg of Object.values(PACKAGES)) {
      expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(pkg.file).toContain(BUKIT_VERSION);
    }
  });

  it("reads the latest release's digest for the daily CI, and nothing it cannot check", async () => {
    const layout = PACKAGES["linux-x64"] as BukitPackage;
    const answer = (body: unknown, status = 200) =>
      (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    const asset = (digest: string | null) => ({
      tag_name: "v2.0.16",
      assets: [{ name: "bukit-2.0.16-linux-x64.tar.gz", browser_download_url: "https://example.invalid/b", digest }],
    });
    expect(
      await latestBukitRelease({
        layout,
        pinnedVersion: BUKIT_VERSION,
        fetchImpl: answer(asset(`sha256:${"b".repeat(64)}`)),
      }),
    ).toEqual({
      version: "2.0.16",
      pkg: { ...layout, file: "bukit-2.0.16-linux-x64.tar.gz", sha256: "b".repeat(64) },
      url: "https://example.invalid/b",
    });
    expect(
      await latestBukitRelease({ layout, pinnedVersion: BUKIT_VERSION, fetchImpl: answer(asset(null)) }),
    ).toMatchObject({ version: "2.0.16", pkg: null });
    await expect(
      latestBukitRelease({ layout, pinnedVersion: BUKIT_VERSION, fetchImpl: answer({}, 403) }),
    ).rejects.toThrow();
    await expect(
      latestBukitRelease({ layout, pinnedVersion: BUKIT_VERSION, fetchImpl: answer({ tag_name: "nightly" }) }),
    ).rejects.toThrow();
  });
});

describe("readPackage", () => {
  it.skipIf(!REAL_TARBALL || !packageForPlatform())("unpacks the official package for this platform", () => {
    const pkg = packageForPlatform() as BukitPackage;
    const data = fs.readFileSync(REAL_TARBALL as string);
    verifySha256(data, pkg.sha256);
    expect([...readPackage(pkg, data).keys()].sort()).toEqual([...pkg.files].sort());
  });
});

// --- locate ---

/** Write a fake Bukit into a bundled-Bukit directory (the only place BukitService looks). */
function installFakeBukit(dir: string, body: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "bukit");
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

describe("locateBukit", () => {
  it("reports missing when the app has no copy", async () => {
    expect(await locateBukit({ dir: path.join(base, "no-bukit"), tmpDir })).toEqual({
      path: null,
      version: null,
      bundledVersion: BUKIT_VERSION,
      state: "missing",
    });
  });

  it("grades the bundled copy's version", async () => {
    for (const [ver, state] of [
      ["2.0.11", "ok"],
      ["2.0.12", "ok"],
      ["2.0.9", "old"],
      ["2.1.0", "unsupported"],
      ["1.9.0", "unsupported"],
    ] as const) {
      const dir = path.join(base, `grade-${ver}`);
      const file = installFakeBukit(dir, `echo "bukit ${ver}+abc"`);
      expect(await locateBukit({ dir, tmpDir })).toEqual({
        path: file,
        version: ver,
        bundledVersion: BUKIT_VERSION,
        state,
      });
    }
    expect(versionState("2.0.10")).toBe("old");
  });

  it("does not cache a failed lookup", async () => {
    const dir = path.join(base, "cachedir");
    installFakeBukit(dir, 'echo "bukit 2.0.11"');
    const badTmp = path.join(base, "tmp-is-a-file");
    fs.writeFileSync(badTmp, "");
    const service = new BukitService({ dir, tmpDir: badTmp });
    await expect(service.status()).rejects.toThrow();
    fs.rmSync(badTmp);
    expect(await service.status()).toMatchObject({ state: "ok", version: "2.0.11" });
  });

  it("reports a found but broken bukit", async () => {
    const dir = path.join(base, "brokendir");
    installFakeBukit(dir, "exit 2");
    expect(await locateBukit({ dir, tmpDir })).toMatchObject({ state: "broken", version: null });
  });

  it.skipIf(!REAL_BIN)("runs the real bukit version", async () => {
    const home = path.join(base, "real-app-home");
    installAppBukit(home, REAL_BIN as string);
    expect(await locateBukit({ dir: testBukitDir(home), tmpDir })).toMatchObject({
      version: BUKIT_VERSION,
      state: "ok",
    });
  });
});

describe("bundled Bukit location (plan 8.1)", () => {
  it("is the resources folder's bukit/ when packaged, vendor/bukit-<version>/ in the repository", () => {
    expect(resolveResources("/repo", {}).bukit).toBe(path.join("/repo", "vendor", `bukit-${BUKIT_VERSION}`));
    expect(devBukitDir("/repo")).toBe(path.join("/repo", "vendor", `bukit-${BUKIT_VERSION}`));
    expect(resolveResources("/repo", { BUKITJALIL_RESOURCES: "/App/Resources/app" }).bukit).toBe(
      path.join("/App/Resources/app", "bukit"),
    );
    // The override is for tests and CI; the packaged app always uses its own copy.
    expect(resolveResources("/repo", { BUKITJALIL_BUKIT_DIR: "/ci/bukit" }).bukit).toBe(path.resolve("/ci/bukit"));
    expect(
      resolveResources("/repo", { BUKITJALIL_RESOURCES: "/App/Resources/app", BUKITJALIL_BUKIT_DIR: "/ci/bukit" })
        .bukit,
    ).toBe(path.join("/App/Resources/app", "bukit"));
  });

  it("removes only the bukit-* copies earlier versions installed in bin/", () => {
    const home = path.join(base, "old-copies");
    for (const name of ["bukit-2.0.11", "bukit-2.0.15", "git"])
      fs.mkdirSync(path.join(home, "bin", name), { recursive: true });
    fs.writeFileSync(path.join(home, "bin", "bukit-note"), "a file, not a copy");
    removeOldAppCopies(home);
    expect(fs.readdirSync(path.join(home, "bin")).sort()).toEqual(["bukit-note", "git"]);
    removeOldAppCopies(path.join(base, "no-such-home"));
  });
});

// --- API ---

describe("/api/bukit", () => {
  it("reports the bundled Bukit; there is no install endpoint", async () => {
    const dir = path.join(base, "api");
    const { app } = makeApp({ bukit: new BukitService({ dir, tmpDir }) });
    expect(await (await app.fetch(req("/api/bukit"))).json()).toEqual({
      status: { path: null, version: null, bundledVersion: BUKIT_VERSION, state: "missing" },
    });
    const install = await app.fetch(
      req("/api/bukit/install", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: "http://127.0.0.1:47880" },
      }),
    );
    expect(install.status).toBe(404);
  });

  it("re-locates when the refresh query is set", async () => {
    const dir = path.join(base, "api-refresh");
    const bukit = new BukitService({ dir, tmpDir });
    const { app, db } = makeApp({ bukit });
    expect(await bukit.status()).toMatchObject({ state: "missing" });

    // A working copy appears after the first (cached) lookup.
    installFakeBukit(dir, 'echo "bukit 2.0.12"');

    const stale = (await (await app.fetch(req("/api/bukit"))).json()) as { status: { state: string } };
    expect(stale.status.state).toBe("missing");
    const fresh = (await (await app.fetch(req("/api/bukit?refresh=1"))).json()) as {
      status: { state: string; version: string };
    };
    expect(fresh.status).toMatchObject({ state: "ok", version: "2.0.12" });
    db.close();
  });

  it("rejects the removed Bukit path setting", async () => {
    const { app } = makeApp();
    const settings = (await (await app.fetch(req("/api/settings"))).json()) as Record<string, unknown>;
    expect(settings).not.toHaveProperty("bukitPath");
    const res = await app.fetch(
      req("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ bukitPath: "/usr/local/bin/bukit" }),
        headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: "http://127.0.0.1:47880" },
      }),
    );
    expect(res.status).toBe(400);
  });
});
