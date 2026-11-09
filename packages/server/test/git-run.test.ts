import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readGlobalIdentity } from "../src/git/identity.ts";
import { checkRepoConfig, isAllowedConfigKey } from "../src/git/repo-check.ts";
import { assertOid, GitError, GitRunner, isOid, isValidBranchName, resolveGitPath } from "../src/git/run.ts";
import { ensureAppHome } from "../src/paths.ts";

// Plan 7.3: hostile repositories must not run anything, and outside values never become options.

const gitPath = resolveGitPath();
if (!gitPath) throw new Error("git is required for these tests");

let base: string;
let git: GitRunner;
let markers: string;
const savedEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };

/** A command that leaves a marker file when git runs it. */
function trap(name: string): string {
  const script = path.join(base, `trap-${name}.sh`);
  fs.writeFileSync(script, `#!/bin/sh\ntouch "${path.join(markers, name)}"\ncat\n`, { mode: 0o755 });
  return script;
}
const fired = (name: string) => fs.existsSync(path.join(markers, name));

/** Plain git, for building the hostile fixtures only. */
function raw(cwd: string, ...args: string[]) {
  return execFileSync(gitPath as string, args, {
    cwd,
    env: { PATH: "/usr/bin:/bin", HOME: base, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    encoding: "utf8",
  });
}

function repo(name: string): string {
  const dir = path.join(base, name);
  fs.mkdirSync(dir);
  raw(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.md"), "hello\n");
  raw(dir, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
  raw(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  return dir;
}

const id = { "user.name": "Test", "user.email": "test@example.com" };

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-git-")));
  markers = path.join(base, "markers");
  fs.mkdirSync(markers);
  const app = ensureAppHome(path.join(base, "app"));
  git = new GitRunner({ gitPath, home: app.home, emptyFile: app.emptyGitConfig, hooksDir: app.emptyHooks });

  // A user global config and ignore file that must never be read: a filter that fires, and "*.md" ignored.
  const userHome = path.join(base, "user-home");
  fs.mkdirSync(path.join(userHome, ".config/git"), { recursive: true });
  fs.writeFileSync(
    path.join(userHome, ".gitconfig"),
    `[filter "evil"]\n\tclean = ${trap("global-filter")}\n\tsmudge = ${trap("global-filter")}\n[core]\n\tfsmonitor = ${trap("global-fsmonitor")}\n`,
  );
  fs.writeFileSync(path.join(userHome, ".config/git/ignore"), "*.md\n");
  process.env.HOME = userHome;
  process.env.XDG_CONFIG_HOME = path.join(userHome, ".config");
});

afterAll(() => {
  process.env.HOME = savedEnv.HOME;
  process.env.XDG_CONFIG_HOME = savedEnv.XDG_CONFIG_HOME;
});

describe("hardened git runner (plan 7.3)", () => {
  it("controls: the traps do fire under plain git, so the tests below can fail", () => {
    const dir = repo("control");
    raw(dir, "config", "core.fsmonitor", trap("control-fsmonitor"));
    fs.writeFileSync(
      path.join(dir, ".git/hooks/pre-commit"),
      `#!/bin/sh\ntouch "${path.join(markers, "control-hook")}"\n`,
      {
        mode: 0o755,
      },
    );
    raw(dir, "status");
    fs.writeFileSync(path.join(dir, ".gitattributes"), "* filter=evil\n");
    fs.writeFileSync(path.join(dir, "x.txt"), "x\n");
    // Global config as a user's own git would read it.
    execFileSync(gitPath as string, ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], {
      cwd: dir,
      env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME },
    });
    raw(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x");
    expect(fired("control-fsmonitor")).toBe(true);
    expect(fired("control-hook")).toBe(true);
    expect(fired("global-filter")).toBe(true);
    fs.rmSync(path.join(markers, "global-filter"));
  });

  it("never runs a repository fsmonitor, even when the config check is skipped", async () => {
    const dir = repo("fsmonitor");
    raw(dir, "config", "core.fsmonitor", trap("fsmonitor"));
    await git.run(["status", "--porcelain=v2"], { cwd: dir, repoCheck: false });
    expect(fired("fsmonitor")).toBe(false);
    await expect(git.run(["status"], { cwd: dir })).rejects.toMatchObject({
      kind: "unsafe_repo",
      details: { reasons: ["config:core.fsmonitor"] },
    });
  });

  it("never runs hooks", async () => {
    const dir = repo("hooks");
    for (const hook of ["pre-commit", "commit-msg", "post-commit", "post-checkout"]) {
      fs.writeFileSync(path.join(dir, ".git/hooks", hook), `#!/bin/sh\ntouch "${path.join(markers, hook)}"\n`, {
        mode: 0o755,
      });
    }
    fs.writeFileSync(path.join(dir, "b.md"), "b\n");
    await git.run(["add", "-A"], { cwd: dir });
    await git.run(["commit", "-q", "-m", "b"], { cwd: dir, config: id });
    await git.run(["checkout", "-q", "--detach"], { cwd: dir });
    for (const hook of ["pre-commit", "commit-msg", "post-commit", "post-checkout"])
      expect(fired(hook), hook).toBe(false);
  });

  it("never signs or verifies signatures with a repository gpg.program", async () => {
    const dir = repo("gpg");
    raw(dir, "config", "gpg.program", trap("gpg"));
    raw(dir, "config", "commit.gpgSign", "true");
    raw(dir, "config", "log.showSignature", "true");
    fs.writeFileSync(path.join(dir, "c.md"), "c\n");
    await git.run(["add", "-A"], { cwd: dir, repoCheck: false });
    await git.run(["commit", "-q", "-m", "c"], { cwd: dir, repoCheck: false, config: id });
    await git.run(["log", "-1"], { cwd: dir, repoCheck: false });
    expect(fired("gpg")).toBe(false);
    await expect(git.checkRepo(dir)).resolves.toMatchObject({
      ok: false,
      reasons: ["config:commit.gpgsign", "config:gpg.program", "config:log.showsignature"],
    });
  });

  it("ignores the user's global config, global filters and global ignore file", async () => {
    const dir = repo("global");
    fs.writeFileSync(path.join(dir, ".gitattributes"), "* filter=evil\n");
    fs.writeFileSync(path.join(dir, "new.md"), "new\n");
    const status = await git.text(["status", "--porcelain=v2", "-z", "--untracked-files=all"], { cwd: dir });
    expect(status).toContain("new.md"); // not hidden by ~/.config/git/ignore
    await git.run(["add", "-A"], { cwd: dir });
    await git.run(["commit", "-q", "-m", "attrs"], { cwd: dir, config: id });
    expect(fired("global-filter")).toBe(false);
    expect(fired("global-fsmonitor")).toBe(false);
  });

  it("checks worktree-scope config, includes and info/attributes", async () => {
    const wt = repo("worktree");
    raw(wt, "config", "extensions.worktreeConfig", "true");
    raw(wt, "config", "--worktree", "core.fsmonitor", trap("wt"));
    expect((await git.checkRepo(wt)).reasons).toEqual(["config:core.fsmonitor"]);

    const inc = repo("include");
    raw(inc, "config", "include.path", "/dev/null");
    expect((await git.checkRepo(inc)).reasons).toEqual(["config:include.path"]);

    const attrs = repo("attributes");
    fs.writeFileSync(path.join(attrs, ".git/info/attributes"), "# comment filter=x\n*.bin filter=lfs\n");
    expect((await git.checkRepo(attrs)).reasons).toEqual(["attributes:filter"]);
  });

  it("re-checks when the config changes", async () => {
    const dir = repo("recheck");
    expect((await git.checkRepo(dir)).ok).toBe(true);
    raw(dir, "config", "core.sshCommand", "evil");
    expect((await git.checkRepo(dir)).reasons).toEqual(["config:core.sshcommand"]);
  });

  it("accepts the config found in ordinary repositories", async () => {
    const dir = repo("ordinary");
    raw(dir, "remote", "add", "origin", "https://github.com/x/y.git");
    raw(dir, "config", "branch.main.remote", "origin");
    raw(dir, "config", "branch.main.merge", "refs/heads/main");
    raw(dir, "config", "branch.Feature/X.vscode-merge-base", "origin/main");
    raw(dir, "config", "lfs.repositoryformatversion", "0");
    raw(dir, "config", "submodule.active", ".");
    raw(dir, "config", "user.name", "Someone");
    expect(await git.checkRepo(dir)).toEqual({ ok: true, reasons: [] });
  });

  it("does not inherit the server environment", async () => {
    process.env.BJ_TEST_SECRET = "leak";
    try {
      expect(Object.keys(git.env()).sort()).toEqual(
        ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_TERMINAL_PROMPT", "HOME", "LANG", "LC_ALL", "PATH"].sort(),
      );
      expect(Object.values(git.env())).not.toContain("leak");
    } finally {
      delete process.env.BJ_TEST_SECRET;
    }
  });

  it("passes the same hardening to git started by Bukit through GIT_CONFIG_*", async () => {
    const env = git.envForChildGit();
    expect(env.GIT_CONFIG_COUNT).toBe("9");
    expect(env.GIT_CONFIG_KEY_0).toBe("core.fsmonitor");
    expect(env.GIT_CONFIG_VALUE_0).toBe("false");
    const dir = repo("childgit");
    raw(dir, "config", "core.fsmonitor", trap("child"));
    execFileSync(gitPath as string, ["status"], { cwd: dir, env: { PATH: "/usr/bin:/bin", HOME: base, ...env } });
    expect(fired("child")).toBe(false);
  });

  it("reads output larger than 1 MiB completely and fails instead of truncating past the cap", async () => {
    const dir = repo("big");
    fs.writeFileSync(path.join(dir, "big.txt"), "x".repeat(3 * 1024 * 1024));
    await git.run(["add", "-A"], { cwd: dir });
    const blob = (await git.text(["rev-parse", ":big.txt"], { cwd: dir })).trim();
    const out = await git.run(["cat-file", "blob", blob], { cwd: dir });
    expect(out.stdout.length).toBe(3 * 1024 * 1024);
    await expect(git.run(["cat-file", "blob", blob], { cwd: dir, maxOutputBytes: 1024 * 1024 })).rejects.toMatchObject({
      kind: "output_too_large",
    });
  });

  it("reports failures with the exit code", async () => {
    const dir = repo("fail");
    const err = await git.run(["rev-parse", "--verify", "nope"], { cwd: dir }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect(err).toMatchObject({ kind: "failed", details: { code: 128 } });
  });
});

describe("argument validation (plan 7.3)", () => {
  it("accepts only full object ids", () => {
    expect(isOid("a".repeat(40))).toBe(true);
    expect(isOid("b".repeat(64))).toBe(true);
    for (const bad of ["a".repeat(39), "HEAD", "--output=/tmp/x", "A".repeat(40), `${"a".repeat(40)}\n`]) {
      expect(isOid(bad), bad).toBe(false);
    }
    expect(() => assertOid("-x")).toThrow(GitError);
  });

  it("checks branch names with git and rejects option-like names first", async () => {
    for (const ok of ["main", "feature/x", "v2.0"]) expect(await isValidBranchName(git, ok, base), ok).toBe(true);
    for (const bad of ["-x", "--output=/tmp/x", "a..b", "a b", "@{-1}", "x.lock", ""]) {
      expect(await isValidBranchName(git, bad, base), bad).toBe(false);
    }
  });
});

describe("config allowlist", () => {
  it("keeps the case of the middle part and lowercases section and variable", () => {
    expect(isAllowedConfigKey("remote.Origin.URL")).toBe(true);
    expect(isAllowedConfigKey("branch.Feature/X.merge")).toBe(true);
    expect(isAllowedConfigKey("includeIf.gitdir:~/x.path")).toBe(false);
    expect(isAllowedConfigKey("remote.origin.uploadpack")).toBe(false);
    expect(isAllowedConfigKey("core.sshcommand")).toBe(false);
  });

  it("only judges repository scopes", () => {
    const list = [
      "command\0core.fsmonitor\nfalse",
      "local\0core.bare\nfalse",
      "worktree\0diff.x.textconv\ncat",
      "",
    ].join("\0");
    expect(checkRepoConfig(list, "")).toEqual({ ok: false, reasons: ["config:diff.x.textconv"] });
  });
});

describe("readGlobalIdentity", () => {
  it("reads user.name and user.email from the global config", async () => {
    const home = path.join(base, "id-home");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, ".gitconfig"), "[user]\n\tname = Ada\n\temail = ada@example.com\n");
    expect(await readGlobalIdentity(gitPath as string, home)).toEqual({ name: "Ada", email: "ada@example.com" });
    const empty = path.join(base, "id-empty");
    fs.mkdirSync(empty);
    expect(await readGlobalIdentity(gitPath as string, empty)).toEqual({ name: null, email: null });
  });
});
