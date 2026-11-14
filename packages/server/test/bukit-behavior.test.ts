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
import { planLanguageMigration } from "../src/sites/language-migration.ts";
import { copyStarter } from "../src/sites/template.ts";
import { rawGit } from "./helpers.ts";

/**
 * The Bukit behaviour BukitJalil relies on (plan 16 #7), run against a real Bukit: CI runs it with the pinned
 * release on every push and with the latest release every day (.github/workflows/bukit-latest.yml). A
 * failure means Bukit changed: check the change, then fix BukitJalil or Bukit, and raise MIN_BUKIT_VERSION
 * when BukitJalil starts to rely on a newer release.
 */
const REAL_BIN = process.env.BUKIT_BIN;
// The scheduled workflow sets this, so a missing Bukit fails there instead of skipping every test.
if (process.env.BUKIT_BEHAVIOUR_REQUIRED && !REAL_BIN) throw new Error("BUKIT_BIN is not set");
const STARTER = path.resolve(import.meta.dirname, "../../../templates/starter");
/** Not a token: Bukit's checks that only need one to be present get this. */
const PLACEHOLDER = "bj-placeholder-not-a-token";
const NOTION_SOURCE =
  "    - type: notion\n      name: notes\n      collection: post\n      notion:\n        databaseId: 0123456789abcdef0123456789abcdef\n";

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

/** A fresh copy of the starter site; `notion` adds a Notion source to it. */
function site(name: string, notion = false): string {
  const dir = path.join(base, name);
  copyStarter(STARTER, dir, { title: "Behaviour", language: "en-US" });
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

describe.skipIf(!REAL_BIN)("Bukit behaviour BukitJalil relies on", () => {
  it(`is at least ${MIN_BUKIT_VERSION}`, async () => {
    const result = await runner.run("version", ["version"], { cwd: base });
    const version = parseBukitVersion(result.stdout);
    expect(version, result.stdout).not.toBeNull();
    expect(versionState(version as string)).toBe("ok");
  });

  // Sites with a bound data source are checked with its token, others without (plan 8.5): `config check`
  // must only need the token to be there, not reach Notion.
  it("config check needs NOTION_TOKEN for a Notion source, and only that it is set", async () => {
    const dir = site("check", true);
    const args = ["config", "check", "--config", "site.yaml"];
    const without = await runner.run("check", args, { cwd: dir });
    expect(checkPassed(without)).toBe(false);
    expect(output(without)).toContain("NOTION_TOKEN");
    const withToken = await runner.run("check", args, { cwd: dir, env: { NOTION_TOKEN: PLACEHOLDER } });
    expect(checkPassed(withToken), output(withToken)).toBe(true);
  });

  // Bukit 2.1 refuses site.language; the migration card's rewrite builds again (plan 8.7).
  // AI checks, AI builds and change previews of a Notion site read the Notion offline snapshot (plan 5.5):
  // no token, and BukitJalil tells "record it again" from "the change needs new Notion data" by the text.
  it("checks and builds a Notion site offline, and says what the snapshot lacks", async () => {
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
    for (const result of await Promise.all(runs())) {
      expect(result.exitCode, output(result)).not.toBe(0);
      expect(notionSnapshotProblemIn(output(result)), output(result)).toBe("stale");
      expect(output(result)).not.toContain(snap);
    }
    // A snapshot of this Bukit that holds no data for the site's database.
    // Bukit 2.1.0 also wants its full version, build metadata included (later releases check the format only).
    const version = /^bukit (\S+)/m.exec((await runner.run("version", ["version"], { cwd: base })).stdout)?.[1];
    fs.mkdirSync(snap);
    fs.writeFileSync(
      path.join(snap, "manifest.json"),
      JSON.stringify({ format: 1, bukitVersion: version, createdAt: "2026-11-14T00:00:00Z", databases: [] }),
    );
    for (const result of await Promise.all(runs())) {
      expect(notionSnapshotProblemIn(output(result)), output(result)).toBe("change");
    }
  });

  it("refuses site.language and accepts the migrated site.yaml", async () => {
    const dir = site("language");
    const file = path.join(dir, "site.yaml");
    const migrated = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, migrated.replace(/ {2}languages: \[ ?en-US ?\]\n/, "  language: en-US\n"));
    const args = ["config", "check", "--config", "site.yaml"];
    const refused = await runner.run("check", args, { cwd: dir });
    expect(checkPassed(refused)).toBe(false);
    expect(output(refused)).toContain("site.language was removed");
    const plan = planLanguageMigration(fs.readFileSync(file, "utf8"));
    if (!plan.needed || !plan.ok) throw new Error("expected a migration");
    fs.writeFileSync(file, plan.text);
    const fixed = await runner.run("check", args, { cwd: dir });
    expect(checkPassed(fixed), output(fixed)).toBe(true);
  });

  // Tokens go on stdin (plan 8.7). The Notion test above already passes its token that way; here Bukit must
  // refuse bad input before doing anything, without echoing it.
  it("refuses unusable --secrets-stdin input without echoing it", () => {
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

  // The preview's basePath is passed as --base-url (plan 16 #8), over the "/" in site.yaml.
  it("builds under --base-url, copying the theme's static files to the output root", async () => {
    const dir = site("base-url");
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
    expect(fs.readFileSync(path.join(out, "robots.txt"), "utf8")).toBe(
      fs.readFileSync(path.join(STARTER, "themes/starter/static/robots.txt"), "utf8"),
    );
  });

  // Publishing builds with the token, then deploys the audited folder with `deploy --skip-build`, which does
  // not get it (plan 14 M6, deploys/service.ts NOTION_STEPS).
  it("deploy --skip-build of a Notion site does not need NOTION_TOKEN", async () => {
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
  });
});
