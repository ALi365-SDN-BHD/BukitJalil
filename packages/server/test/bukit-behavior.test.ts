import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIN_BUKIT_VERSION } from "../src/bukit/install.ts";
import { versionState } from "../src/bukit/locate.ts";
import { notionSnapshotProblemIn } from "../src/bukit/notion-errors.ts";
import { BukitRunner, checkPassed, DEPLOY_TOKEN_ENV, parseBukitVersion } from "../src/bukit/runner.ts";
import { GitRunner, resolveGitPath } from "../src/git/run.ts";
import { ensureAppHome } from "../src/paths.ts";
import { commitAllAs, rawGit } from "./helpers.ts";

/**
 * The Bukit behaviour BukitJalil relies on (plan 16 #7), run against a real Bukit: CI runs it with the pinned
 * release on every push and with the latest release every day (.github/workflows/bukit-latest.yml). A
 * failure means Bukit changed: check the change, then fix BukitJalil or Bukit, and raise MIN_BUKIT_VERSION
 * when BukitJalil starts to rely on a newer release.
 */
const REAL_BIN = process.env.BUKIT_BIN;
// The scheduled workflow sets this, so a missing Bukit fails there instead of skipping every test.
if (process.env.BUKIT_BEHAVIOUR_REQUIRED && !REAL_BIN) throw new Error("BUKIT_BIN is not set");
/** Not a token: Bukit's checks that only need one to be present get this. */
const PLACEHOLDER = "bj-placeholder-not-a-token";
const NOTION_SOURCE =
  "  - type: notion\n    name: notes\n    collection: post\n    notion:\n      databaseId: 0123456789abcdef0123456789abcdef\n";

const gitPath = resolveGitPath();
if (!gitPath) throw new Error("git is required for these tests");

let base: string;
let git: GitRunner;
let runner: BukitRunner;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-behavior-")));
  const app = ensureAppHome(path.join(base, "app"));
  git = new GitRunner({ gitPath, home: app.home, emptyFile: app.emptyGitConfig, hooksDir: app.emptyHooks });
  if (REAL_BIN) runner = new BukitRunner({ bukitPath: REAL_BIN, git, home: app.home, tmpDir: app.bukitTmp });
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

/** A fresh site from `bukit new` (plan 5.2); `notion` adds a Notion source to it. */
function site(name: string, notion = false): string {
  const dir = path.join(base, name);
  const created = spawnSync(REAL_BIN as string, ["new", dir, "--title=Behaviour", "--language=en-US"], {
    env: runner.env(),
    encoding: "utf8",
  });
  if (created.status !== 0) throw new Error(`bukit new failed: ${created.stdout}\n${created.stderr}`);
  if (notion) addNotionSource(dir);
  return dir;
}

function addNotionSource(dir: string, extra = ""): void {
  const file = path.join(dir, "site.yaml");
  const yaml = fs
    .readFileSync(file, "utf8")
    .replace("content:\n  sources:\n", `content:\n  sources:\n${NOTION_SOURCE}`);
  if (!yaml.includes("type: notion")) throw new Error("starter site.yaml has no content.sources");
  fs.writeFileSync(file, yaml + extra);
}

const output = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`;

/** A 1x1 PNG: the upload tests only need bytes that are copied, not a decoded image. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
/** Add themes/starter/static/uploads/a.png; returns its path. */
function addUpload(dir: string): string {
  const file = path.join(dir, "themes/starter/static/uploads/a.png");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG);
  return file;
}
/** Replace site.baseUrl in the starter's site.yaml. */
function setBaseUrl(dir: string, baseUrl: string): void {
  const file = path.join(dir, "site.yaml");
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("baseUrl: /")) throw new Error("starter site.yaml has no baseUrl");
  fs.writeFileSync(file, text.replace("baseUrl: /", `baseUrl: ${baseUrl}`));
}
/** Build the site into a subdirectory and return the run result. */
function build(dir: string, out: string, extra: readonly string[] = []) {
  return runner.run("build", ["build", "--config", "site.yaml", "--output", out, "--log-format", "json", ...extra], {
    cwd: dir,
  });
}

describe.skipIf(!REAL_BIN)("Bukit behaviour BukitJalil relies on", () => {
  it(`is at least ${MIN_BUKIT_VERSION}`, async () => {
    const result = await runner.run("version", ["version"], { cwd: base });
    const version = parseBukitVersion(result.stdout);
    expect(version, result.stdout).not.toBeNull();
    expect(versionState(version as string)).toBe("ok");
  });

  // Sites with a bound data source are checked with its token, others without (plan 8.5): `config check`
  // must only need the token to be there, not reach Notion.
  it.skipIf(process.platform === "win32")(
    "config check needs NOTION_TOKEN for a Notion source, and only that it is set",
    async () => {
      const dir = site("check", true);
      const args = ["config", "check", "--config", "site.yaml"];
      const without = await runner.run("check", args, { cwd: dir });
      expect(checkPassed(without)).toBe(false);
      expect(output(without)).toContain("NOTION_TOKEN");
      const withToken = await runner.run("check", args, { cwd: dir, env: { NOTION_TOKEN: PLACEHOLDER } });
      expect(checkPassed(withToken), output(withToken)).toBe(true);
    },
  );

  // AI checks, AI builds and change previews of a Notion site read the Notion offline snapshot (plan 5.5):
  // no token, and BukitJalil tells "record it again" from "the change needs new Notion data" by the BKT codes.
  it.skipIf(process.platform === "win32")(
    "checks and builds a Notion site offline, and says what the snapshot lacks",
    async () => {
      const dir = site("offline", true);
      const snap = path.join(base, "offline-snapshot");
      const offline = ["--notion-snapshot", snap, "--notion-offline"];
      const runs = () => [
        runner.run("check", ["config", "check", "--config", "site.yaml", ...offline], { cwd: dir }),
        runner.run("doctor", ["doctor", "--config", "site.yaml", ...offline], { cwd: dir }),
        runner.run(
          "build",
          [
            "build",
            "--config",
            "site.yaml",
            "--output",
            "out",
            ...offline,
            "--cache-dir",
            path.join(base, "offline-cache"),
            "--log-format",
            "json",
          ],
          { cwd: dir },
        ),
      ];
      const [check, doctor, build] = await Promise.all(runs());
      if (!check || !doctor || !build) throw new Error("missing run result");
      for (const result of [check, doctor, build]) {
        expect(result.exitCode, output(result)).not.toBe(0);
        expect(notionSnapshotProblemIn(output(result)), output(result)).toBe("stale");
        expect(output(result)).not.toContain(snap);
      }
      expect(build.exitCode).toBe(2);
      expect(output(build)).toContain('"code": "BKT-0B10"');
      expect(output(check)).toContain("[BKT-0B10]");
      expect(output(doctor)).toContain("[BKT-0B10]");

      // A snapshot of this Bukit holding no data for the site's database; the format is read, not the version.
      fs.mkdirSync(snap);
      fs.writeFileSync(
        path.join(snap, "manifest.json"),
        JSON.stringify({ format: 1, bukitVersion: "2.0.0", createdAt: "2026-11-14T00:00:00Z", databases: [] }),
      );
      const [check2, doctor2, build2] = await Promise.all(runs());
      if (!check2 || !doctor2 || !build2) throw new Error("missing run result");
      for (const result of [check2, doctor2, build2]) {
        expect(notionSnapshotProblemIn(output(result)), output(result)).toBe("change");
        expect(output(result)).not.toContain(snap);
      }
      expect(build2.exitCode).toBe(2);
      expect(output(build2)).toContain('"code": "BKT-0B11"');
      expect(output(check2)).toContain("[BKT-0B11]");
      expect(output(doctor2)).toContain("[BKT-0B11]");
    },
  );

  // Tokens go on stdin (plan 8.7). The Notion test above already passes its token that way; here Bukit must
  // refuse bad input before doing anything, without echoing it.
  it.skipIf(process.platform === "win32")("refuses unusable --secrets-stdin input without echoing it", () => {
    const dir = site("stdin", true);
    const bad = spawnSync(REAL_BIN as string, ["config", "check", "--config", "site.yaml", "--secrets-stdin"], {
      cwd: dir,
      env: runner.env(),
      input: `{"NOTION_TOKEN": 1, "x": "${PLACEHOLDER}"}`,
      encoding: "utf8",
    });
    expect(bad.status).toBe(2);
    expect(`${bad.stdout}${bad.stderr}`).toContain("--secrets-stdin values must be JSON strings");
    expect(`${bad.stdout}${bad.stderr}`).not.toContain(PLACEHOLDER);
  });

  // Bukit 2.2.6 (PR #197) refuses a file with more than one YAML document; before, it silently read only the
  // first. The guard refuses it too (bukit/guard.ts), and `bukit new` no longer ends site.yaml with "...".
  it("rejects a site.yaml with more than one YAML document (BKT-0003)", async () => {
    const dir = site("multi-doc");
    const file = path.join(dir, "site.yaml");
    const text = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, `${text.trimEnd()}\n...\nnotABukitKey: 1\n---\nsite: {}\n`);
    const result = await runner.run("check", ["config", "check", "--config", "site.yaml"], { cwd: dir });
    expect(checkPassed(result), output(result)).toBe(false);
    expect(output(result)).toContain("BKT-0003");
    expect(output(result)).toContain("more than one YAML document");
  });

  // The preview's basePath is passed as --base-url (plan 16 #8), over the "/" in site.yaml.
  it("builds under --base-url, copying the theme's static files to the output root", async () => {
    const dir = site("base-url");
    const robots = fs.readFileSync(path.join(dir, "themes/starter/static/robots.txt"), "utf8");
    const result = await runner.run(
      "build",
      ["build", "--config", "site.yaml", "--output", "out", "--base-url", "/docs/", "--log-format", "json"],
      { cwd: dir },
    );
    expect(result.exitCode, output(result)).toBe(0);
    const out = path.join(dir, "out");
    const index = fs.readFileSync(path.join(out, "index.html"), "utf8");
    expect(index).toMatch(/href="\/docs\/assets\/[^"]*\.css"/);
    expect(index).not.toMatch(/href="\/assets\//);
    expect(index).toContain('href="/docs/blog/');
    // themes/starter/static/robots.txt, as is, at the root of the output (not under the base path).
    expect(fs.readFileSync(path.join(out, "robots.txt"), "utf8")).toBe(robots);
  });

  // Material uploads live in the theme's static/ tree: Bukit copies it as is, whether or not a page uses it.
  it("copies theme static uploads even when nothing references them", async () => {
    const dir = site("upload-copy");
    const file = addUpload(dir);
    const result = await build(dir, "out");
    expect(result.exitCode, output(result)).toBe(0);
    const copied = fs.readFileSync(path.join(dir, "out/uploads/a.png"));
    expect(copied.equals(fs.readFileSync(file))).toBe(true);
  });

  // BukitJalil's upload URL contains site.baseUrl. Bukit does not rewrite root paths in Markdown, so only
  // the prefixed form works on a sub-path site; templates get the prefix from site.base_url.
  it("keeps root-relative upload links and resolves baseUrl-prefixed links", async () => {
    const dir = site("upload-base-url");
    addUpload(dir);
    setBaseUrl(dir, "/blog/");
    fs.appendFileSync(
      path.join(dir, "content/pages/about.md"),
      "\n![raw](/uploads/a.png)\n![prefixed](/blog/uploads/a.png)\n",
    );
    const layout = path.join(dir, "themes/starter/layouts/layouts/base.html");
    const layoutText = fs.readFileSync(layout, "utf8");
    const stylesheet = '<link rel="stylesheet" href="{{ asset_base_url }}/assets/style.css" />';
    if (!layoutText.includes(stylesheet)) throw new Error("starter base layout has no stylesheet link");
    fs.writeFileSync(
      layout,
      layoutText.replace(stylesheet, `${stylesheet}\n  <link rel="icon" href="{{ base_url }}/uploads/a.png" />`),
    );

    for (const [out, extra] of [
      ["out-preview", ["--base-url", "/blog/"]],
      ["out-publish", []],
    ] as const) {
      const result = await build(dir, out, extra);
      expect(result.exitCode, output(result)).toBe(0);
      const html = fs.readFileSync(path.join(dir, out, "pages/about/index.html"), "utf8");
      expect(html).toContain('src="/uploads/a.png"');
      expect(html).toContain('src="/blog/uploads/a.png"');
      expect(html).toContain('href="/blog/uploads/a.png"');
    }
  });

  // Multilingual builds copy the theme's static/ tree to the root and to each language directory, so a
  // template using site.base_url with a language prefix still finds the file (design 6.1 item 3).
  it.skipIf(process.platform === "win32")(
    "copies theme static uploads to the root and language directories",
    async () => {
      const dir = site("upload-i18n");
      addUpload(dir);
      const yaml = path.join(dir, "site.yaml");
      const text = fs.readFileSync(yaml, "utf8");
      const languages = "  languages:\n  - en-US\n";
      if (!text.includes(languages)) throw new Error("starter site.yaml has no languages");
      fs.writeFileSync(yaml, text.replace(languages, "  languages: [en-US, zh-CN]\n  defaultLanguage: en-US\n"));
      fs.writeFileSync(path.join(dir, ".gitignore"), "out/\n");
      rawGit(base, dir, "init", "-q");
      commitAllAs(base, dir);

      const result = await build(dir, "out");
      expect(result.exitCode, output(result)).toBe(0);
      const root = fs.readFileSync(path.join(dir, "out/uploads/a.png"));
      const zh = fs.readFileSync(path.join(dir, "out/zh-CN/uploads/a.png"));
      expect(root.equals(PNG)).toBe(true);
      expect(zh.equals(PNG)).toBe(true);
    },
  );

  // Publishing builds with the token, then deploys the audited folder with `deploy --skip-build`, which does
  // not get it (plan 14 M6, deploys/service.ts NOTION_STEPS).
  it.skipIf(process.platform === "win32")(
    "deploy --skip-build of a Notion site does not need NOTION_TOKEN",
    async () => {
      // Built without the Notion source, standing in for the folder an earlier step built with the token;
      // then the source is added, as in the site.yaml deploy reads.
      const dir = site("deploy");
      const build = await runner.run("build", ["build", "--config", "site.yaml", "--output", "out"], { cwd: dir });
      expect(build.exitCode, output(build)).toBe(0);
      addNotionSource(dir, "\ndeploy:\n  provider: github-pages\n  repo: someone/someone.github.io\n");

      const bare = path.join(base, "pages.git");
      rawGit(base, base, "init", "-q", "--bare", bare);
      // Bukit checks its remote's address, so only the remote name in ls-remote / fetch / push is swapped.
      const wrapper = path.join(base, "git-wrapper");
      fs.writeFileSync(
        wrapper,
        `#!/bin/sh
case " $* " in *" ls-remote "*|*" fetch "*|*" push "*) net=1;; *) net=0;; esac
n=$#
for a in "$@"; do
  if [ $net = 1 ]; then case "$a" in bukit-deploy-*) a="${bare}";; esac; fi
  set -- "$@" "$a"
done
shift $n
# Bukit 2.2.3 allows only https for deploy; the stand-in remote is a local bare repository.
[ $net = 1 ] && export GIT_ALLOW_PROTOCOL=file
exec "${gitPath}" "$@"
`,
        { mode: 0o755 },
      );
      const app = ensureAppHome(path.join(base, "deploy-app"));
      const deployGit = new GitRunner({
        gitPath: wrapper,
        home: app.home,
        emptyFile: app.emptyGitConfig,
        hooksDir: app.emptyHooks,
      });
      const deployRunner = new BukitRunner({
        bukitPath: REAL_BIN as string,
        git: deployGit,
        home: app.home,
        tmpDir: app.bukitTmp,
      });
      const result = await deployRunner.run(
        "deploy",
        [
          "deploy",
          "--config",
          "site.yaml",
          "--skip-build",
          "--output",
          "out",
          "--repo",
          "someone/someone.github.io",
          "--branch",
          "gh-pages",
          "--token-env",
          DEPLOY_TOKEN_ENV,
        ],
        { cwd: dir, deploy: { token: PLACEHOLDER, name: "Site Owner", email: "owner@example.com" } },
      );
      expect(result.exitCode, output(result)).toBe(0);
      const files = rawGit(base, base, "--git-dir", bare, "ls-tree", "-r", "--name-only", "gh-pages").split("\n");
      expect(files).toContain("index.html");
    },
  );
});
