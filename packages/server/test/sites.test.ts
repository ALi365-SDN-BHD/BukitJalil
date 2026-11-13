import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ImportInspection, Site } from "@bukitjalil/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BukitService } from "../src/bukit/locate.ts";
import { resolveGitPath } from "../src/git/run.ts";
import { withBlock } from "../src/sites/exclude.ts";
import { checkSiteLocation, listDirs, realPathOf, SiteError } from "../src/sites/location.ts";
import { SiteLocks } from "../src/sites/locks.ts";
import { copyStarter } from "../src/sites/template.ts";
import { ADMIN, commitAllAs, installAppBukit, makeApp, rawGit, req, testBukitDir } from "./helpers.ts";

const STARTER = path.resolve(import.meta.dirname, "../../../templates/starter");
const REAL_BIN = process.env.BUKIT_BIN;
const _gitPath = resolveGitPath() as string;

let base: string;
let userHome: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-sites-")));
  userHome = path.join(base, "home");
  fs.mkdirSync(userHome);
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

/** Plain git for fixtures only. */
const raw = (cwd: string, ...args: string[]) => rawGit(base, cwd, ...args);
const commitAll = (dir: string, msg = "init") => commitAllAs(base, dir, msg);

/** A git repository holding the starter site, on branch `branch`. */
function starterRepo(name: string, branch = "main"): string {
  const dir = path.join(userHome, name);
  copyStarter(STARTER, dir, { title: name, language: "en-US" });
  raw(dir, "init", "-q", "-b", branch);
  commitAll(dir);
  return dir;
}

const send = (method: string, url: string, body?: unknown) =>
  req(url, {
    method,
    body: JSON.stringify(body ?? {}),
    headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
  });

function setup(opts: { bukit?: BukitService } = {}) {
  const ctx = makeApp({ userHome, appHome: fs.mkdtempSync(path.join(base, "app-")), bukit: opts.bukit });
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const res = await ctx.app.fetch(method === "GET" ? req(url) : send(method, url, body));
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
  };
  const identity = () => call("PUT", "/api/settings", { commitName: "Site Owner", commitEmail: "owner@example.com" });
  return { ...ctx, call, identity };
}

// --- location rules and directory picker ---

describe("site location (plan 5.2)", () => {
  const appHome = () => path.join(base, "loc-app");
  const rules = (sites: { name: string; path: string }[] = []) => ({ appHome: appHome(), userHome, sites });

  it("refuses the root, the home directory and the app data directory", () => {
    const code = (p: string, sites: { name: string; path: string }[] = []) => {
      try {
        checkSiteLocation(p, rules(sites));
        return "ok";
      } catch (err) {
        return `${(err as SiteError).code}:${(err as SiteError).params.reason ?? (err as SiteError).params.site ?? ""}`;
      }
    };
    fs.mkdirSync(appHome(), { recursive: true });
    expect(code("/")).toBe("site.path_forbidden:root");
    expect(code(userHome)).toBe("site.path_forbidden:home");
    expect(code(path.join(appHome(), "x"))).toBe("site.path_forbidden:app_data");
    expect(code(base)).toBe("site.path_forbidden:app_data"); // would contain the app data directory
    expect(code("relative/x")).toBe("site.path_forbidden:relative");
    const site = { name: "Blog", path: path.join(userHome, "blog") };
    expect(code(path.join(userHome, "blog", "inner"), [site])).toBe("site.path_overlaps_site:Blog");
    expect(code(path.join(userHome, "blog"), [site])).toBe("site.already_registered:");
    expect(code(path.join(userHome, "other"), [site])).toBe("ok");
  });

  it("compares real paths, so a symlinked path cannot dodge the rules", () => {
    const link = path.join(base, "link-to-home");
    fs.symlinkSync(userHome, link);
    expect(realPathOf(path.join(link, "new", "site"))).toBe(path.join(userHome, "new", "site"));
    expect(() => checkSiteLocation(link, rules())).toThrow(SiteError);
  });

  it("compares the names on disk, so a path typed in another case cannot dodge the rules", () => {
    const dir = path.join(base, "CaseSite");
    fs.mkdirSync(dir, { recursive: true });
    const lower = path.join(base, "casesite");
    // Only on a case-insensitive file system (macOS, Windows) is the other spelling the same folder.
    if (!fs.existsSync(lower)) return;
    expect(realPathOf(path.join(lower, "new"))).toBe(path.join(dir, "new"));
    expect(() => checkSiteLocation(path.join(lower, "inner"), rules([{ name: "Case", path: dir }]))).toThrow(
      /path_overlaps_site/,
    );
  });

  it("lists subdirectories only, without hidden ones or symlinks", () => {
    const dir = path.join(base, "picker");
    fs.mkdirSync(path.join(dir, "b"), { recursive: true });
    fs.mkdirSync(path.join(dir, "a"));
    fs.mkdirSync(path.join(dir, ".hidden"));
    fs.writeFileSync(path.join(dir, "file.txt"), "");
    fs.symlinkSync(path.join(dir, "a"), path.join(dir, "link"));
    expect(listDirs(dir)).toEqual({ path: dir, parent: base, dirs: ["a", "b"] });
    expect(listDirs(dir, { hidden: true }).dirs).toEqual([".hidden", "a", "b"]);
    expect(listDirs(undefined, { userHome }).path).toBe(userHome);
    expect(listDirs("/").parent).toBeNull();
    expect(() => listDirs(path.join(dir, "file.txt"))).toThrow(/not_directory/);
    expect(() => listDirs(path.join(dir, "missing"))).toThrow(/not_found/);
    expect(() => listDirs("relative")).toThrow(/not_found/);
  });
});

describe("exclude block and locks", () => {
  it("adds, replaces and removes only its own block", () => {
    const user = "# mine\n*.log\n";
    const added = withBlock(user, ["dist/"]);
    expect(added).toBe("# mine\n*.log\n# BukitJalil begin\ndist/\n# BukitJalil end\n");
    expect(withBlock(added, ["dist/", ".bukit/"])).toBe(
      "# mine\n*.log\n# BukitJalil begin\ndist/\n.bukit/\n# BukitJalil end\n",
    );
    expect(withBlock(added, null)).toBe(user);
    expect(withBlock("", null)).toBe("");
  });

  it("refuses a second operation on a busy site", async () => {
    const locks = new SiteLocks();
    let release: () => void = () => {};
    const first = locks.run("s", "recheck", () => new Promise<void>((r) => (release = r)));
    await expect(locks.run("s", "remove", async () => {})).rejects.toMatchObject({
      code: "site.busy",
      params: { operation: "recheck" },
    });
    await expect(locks.run("other", "remove", async () => 1)).resolves.toBe(1);
    release();
    await first;
    await expect(locks.run("s", "remove", async () => 2)).resolves.toBe(2);
  });
});

// --- create ---

describe("create a site (plan 5.2)", () => {
  it("needs the commit identity first", async () => {
    const { call } = setup();
    const res = await call("POST", "/api/sites", { name: "x", path: path.join(userHome, "noid"), language: "en" });
    expect(res).toEqual({ status: 400, json: { code: "site.identity_required" } });
    expect(fs.existsSync(path.join(userHome, "noid"))).toBe(false);
  });

  it("copies the starter, commits it on main and creates the main checkout", async () => {
    const { call, identity, paths } = setup();
    await identity();
    const target = path.join(userHome, "Sites", "first");
    const res = await call<Site>("POST", "/api/sites", { name: "我的网站", path: target, language: "zh-CN" });
    expect(res.status).toBe(201);
    const site = res.json;
    expect(site).toMatchObject({ name: "我的网站", path: target, defaultBranch: "main", readOnly: null });
    expect(site.configCheck).toBe("not_run"); // no Bukit in this test
    expect(site.checkedCommit).toMatch(/^[0-9a-f]{40}$/);

    expect(raw(target, "log", "--format=%an <%ae>|%cn <%ce>|%s").trim()).toBe(
      "Site Owner <owner@example.com>|Site Owner <owner@example.com>|Initial site from BukitJalil starter",
    );
    expect(raw(target, "status", "--porcelain")).toBe("");
    expect(fs.readFileSync(path.join(target, ".git/info/exclude"), "utf8")).toContain(
      "# BukitJalil begin\ndist/\n.bukit/\n.cache/\n.bukitjalil-build/\n.bukitjalil-deploy/\n# BukitJalil end",
    );
    const checkout = path.join(paths.worktrees, site.id, "main");
    expect(fs.existsSync(path.join(checkout, "site.yaml"))).toBe(true);
    expect(raw(checkout, "rev-parse", "HEAD").trim()).toBe(site.checkedCommit);
    expect(fs.existsSync(path.join(target, "dist"))).toBe(false);

    const settings = await call<{ lastParentDir: string }>("GET", "/api/settings");
    expect(settings.json.lastParentDir).toBe(path.join(userHome, "Sites"));
    expect((await call<Site[]>("GET", "/api/sites")).json.map((s) => s.id)).toEqual([site.id]);

    const again = await call("POST", "/api/sites", { name: "x", path: target, language: "en" });
    expect(again.status).toBe(409);
    const inner = await call("POST", "/api/sites", { name: "x", path: path.join(target, "inner"), language: "en" });
    expect(inner.json).toEqual({ code: "site.path_overlaps_site", params: { site: "我的网站" } });
  });

  it("refuses a non-empty directory and invalid input", async () => {
    const { call, identity } = setup();
    await identity();
    const full = path.join(userHome, "full");
    fs.mkdirSync(full);
    fs.writeFileSync(path.join(full, "keep.txt"), "mine");
    expect((await call("POST", "/api/sites", { name: "x", path: full, language: "en" })).json).toEqual({
      code: "site.path_not_empty",
    });
    expect(fs.readdirSync(full)).toEqual(["keep.txt"]);
    for (const body of [
      { name: "", path: path.join(userHome, "a"), language: "en" },
      { name: "a‮b", path: path.join(userHome, "a"), language: "en" },
      { name: "a", path: "relative", language: "en" },
      { name: "a", path: path.join(userHome, "a"), language: "en_US" },
      { name: "a", path: path.join(userHome, "a"), language: "en", extra: 1 },
    ]) {
      expect((await call("POST", "/api/sites", body)).status).toBe(400);
    }
  });

  it.skipIf(!REAL_BIN)(
    "runs bukit config check in the main checkout",
    async () => {
      const home = path.join(base, "bk");
      installAppBukit(home, REAL_BIN as string);
      const bukit = new BukitService({
        dir: testBukitDir(home),
        tmpDir: path.join(base, "bk-tmp"),
      });
      const { call, identity } = setup({ bukit });
      await identity();
      const res = await call<Site>("POST", "/api/sites", {
        name: "Real",
        path: path.join(userHome, "real-bukit"),
        language: "en-US",
      });
      expect(res.json).toMatchObject({ readOnly: null, configCheck: "ok" });
    },
    60_000,
  );
});

// --- import ---

describe("import a site (plan 5.1)", () => {
  it("imports a clean repository on its current branch", async () => {
    const { call, paths } = setup();
    const dir = starterRepo("imp-clean", "dev");
    const inspect = await call<ImportInspection>("POST", "/api/sites/import/inspect", { path: dir });
    expect(inspect.json).toEqual({ kind: "git", path: dir, branch: "dev", readOnly: null });
    const res = await call<Site>("POST", "/api/sites/import", { path: dir });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ name: "imp-clean", defaultBranch: "dev", readOnly: null });
    expect(fs.existsSync(path.join(paths.worktrees, res.json.id, "main", "site.yaml"))).toBe(true);
  });

  it("refuses what it cannot import", async () => {
    const { call } = setup();
    const code = async (p: string) =>
      (await call<{ code: string }>("POST", "/api/sites/import/inspect", { path: p })).json.code;

    const dirty = starterRepo("imp-dirty");
    fs.appendFileSync(path.join(dirty, "site.yaml"), "# local change\n");
    expect(await code(dirty)).toBe("site.dirty");

    const detached = starterRepo("imp-detached");
    raw(detached, "checkout", "-q", "--detach");
    expect(await code(detached)).toBe("site.detached_head");

    const outer = starterRepo("imp-outer");
    fs.mkdirSync(path.join(outer, "sub"));
    fs.writeFileSync(path.join(outer, "sub", "site.yaml"), "site:\n  title: x\n");
    expect(await code(path.join(outer, "sub"))).toBe("site.not_repo_root");

    const empty = path.join(userHome, "imp-empty");
    fs.mkdirSync(empty);
    fs.writeFileSync(path.join(empty, "site.yaml"), "site:\n  title: x\n");
    raw(empty, "init", "-q", "-b", "main");
    expect(await code(empty)).toBe("site.no_commits");

    const noYaml = path.join(userHome, "imp-noyaml");
    fs.mkdirSync(noYaml);
    expect(await code(noYaml)).toBe("site.no_site_yaml");
    expect(await code(path.join(userHome, "missing"))).toBe("fs.not_found");
  });

  it("imports a repository with unsafe config read-only, without running anything", async () => {
    const { call, paths } = setup();
    const dir = starterRepo("imp-hostile");
    const marker = path.join(base, "fsmonitor-fired");
    const trap = path.join(base, "trap.sh");
    fs.writeFileSync(trap, `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    raw(dir, "config", "core.fsmonitor", trap);
    raw(dir, "config", "filter.evil.clean", trap);

    const inspect = await call<ImportInspection>("POST", "/api/sites/import/inspect", { path: dir });
    expect(inspect.json).toMatchObject({
      kind: "git",
      branch: "main",
      readOnly: [
        { code: "repo_config", where: "core.fsmonitor" },
        { code: "repo_config", where: "filter.evil.clean" },
      ],
    });
    const res = await call<Site>("POST", "/api/sites/import", { path: dir });
    expect(res.json.readOnly?.map((r) => r.where)).toEqual(["core.fsmonitor", "filter.evil.clean"]);
    expect(res.json.checkedCommit).toBeNull();
    expect(fs.existsSync(path.join(paths.worktrees, res.json.id))).toBe(false);
    expect(fs.readFileSync(path.join(dir, ".git/info/exclude"), "utf8")).not.toContain("BukitJalil");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("imports a site that fails the pre-build guard read-only", async () => {
    const { call, paths } = setup();
    const dir = path.join(userHome, "imp-guard");
    copyStarter(STARTER, dir, { title: "g", language: "en" });
    fs.symlinkSync("/etc/passwd", path.join(dir, "content", "posts", "leak.md"));
    raw(dir, "init", "-q", "-b", "main");
    commitAll(dir);
    const res = await call<Site>("POST", "/api/sites/import", { path: dir });
    expect(res.json.readOnly).toEqual([{ code: "symlink", where: "content/posts/leak.md" }]);
    expect(res.json.checkedCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(fs.existsSync(path.join(paths.worktrees, res.json.id))).toBe(false);
  });

  it("initializes a plain directory only with the confirmed file list", async () => {
    const { call, identity } = setup();
    const dir = path.join(userHome, "imp-plain");
    copyStarter(STARTER, dir, { title: "Plain", language: "en" });
    fs.writeFileSync(path.join(dir, ".env"), "SECRET=1\n");
    fs.mkdirSync(path.join(dir, "dist"));
    fs.writeFileSync(path.join(dir, "dist", "index.html"), "old build");
    fs.mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "x", "i.js"), "");

    const inspect = await call<ImportInspection>("POST", "/api/sites/import/inspect", { path: dir });
    if (inspect.json.kind !== "not_git") throw new Error("expected not_git");
    const files = inspect.json.files;
    expect(files).toContain("site.yaml");
    expect(files).toContain("content/posts/welcome.md");
    expect(files.filter((f) => /^(\.env|dist\/|node_modules\/)/.test(f))).toEqual([]);
    expect(fs.existsSync(path.join(dir, ".git"))).toBe(false);

    expect((await call("POST", "/api/sites/import", { path: dir })).json).toEqual({ code: "site.not_git" });
    expect((await call("POST", "/api/sites/import", { path: dir, initGit: { files } })).json).toEqual({
      code: "site.identity_required",
    });
    await identity();
    fs.writeFileSync(path.join(dir, "content", "posts", "late.md"), "# added after review\n");
    expect((await call("POST", "/api/sites/import", { path: dir, initGit: { files } })).json).toEqual({
      code: "site.file_list_changed",
    });
    expect(fs.existsSync(path.join(dir, ".git"))).toBe(false);

    const res = await call<Site>("POST", "/api/sites/import", {
      path: dir,
      initGit: { files: [...files, "content/posts/late.md"] },
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ name: "Plain", defaultBranch: "main", readOnly: null });
    const tracked = raw(dir, "ls-files").trim().split("\n");
    expect(tracked).not.toContain(".env");
    expect(tracked.some((f) => f.startsWith("dist/"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, ".env"), "utf8")).toBe("SECRET=1\n");
    // The check after import keeps the import's own excludes: .env stays ignored in the user's folder.
    expect(raw(dir, "status", "--porcelain")).not.toContain(".env");
    await call("POST", `/api/sites/${res.json.id}/recheck`, {});
    const exclude = fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain(".env*");
    expect(exclude).toContain("node_modules/");
    expect(exclude).toContain(".bukitjalil-deploy/");
  });

  it("refuses a plain directory that contains another repository", async () => {
    const { call } = setup();
    const dir = path.join(userHome, "imp-nested");
    copyStarter(STARTER, dir, { title: "n", language: "en" });
    fs.mkdirSync(path.join(dir, "vendor", "lib"), { recursive: true });
    raw(path.join(dir, "vendor", "lib"), "init", "-q");
    expect((await call("POST", "/api/sites/import/inspect", { path: dir })).json).toEqual({
      code: "site.nested_repo",
      params: { path: "vendor/lib" },
    });
  });

  it("refuses a .git symlink instead of writing through it", async () => {
    const ctx = setup();
    const dir = path.join(userHome, "imp-git-link");
    copyStarter(STARTER, dir, { title: "link", language: "en" });
    const target = path.join(base, "git-link-target");
    fs.symlinkSync(target, path.join(dir, ".git"));

    const inspect = await ctx.call<{ code: string }>("POST", "/api/sites/import/inspect", { path: dir });
    expect(inspect).toEqual({ status: 400, json: { code: "site.git_symlink" } });
    expect(fs.existsSync(target)).toBe(false);

    // If a link appears after the import's own inspection, initForImport must still refuse to run git init.
    fs.rmSync(path.join(dir, ".git"));
    const clean = await ctx.call<ImportInspection>("POST", "/api/sites/import/inspect", { path: dir });
    if (clean.json.kind !== "not_git") throw new Error("expected not_git");
    fs.symlinkSync(target, path.join(dir, ".git"));
    const sites = ctx.sites as unknown as {
      initForImport(real: string, files: string[], identity: Record<string, string>): Promise<void>;
    };
    await expect(
      sites.initForImport(dir, clean.json.files, { "user.name": "Site Owner", "user.email": "owner@example.com" }),
    ).rejects.toMatchObject({ code: "site.file_list_changed" });
    expect(fs.existsSync(target)).toBe(false);
  });
});

// --- details, patch, remove ---

describe("manage a site", () => {
  it("renames, archives and rechecks", async () => {
    const { call } = setup();
    const dir = starterRepo("mng");
    const site = (await call<Site>("POST", "/api/sites/import", { path: dir })).json;
    expect(
      (await call<Site>("PATCH", `/api/sites/${site.id}`, { name: "Renamed", archived: true })).json,
    ).toMatchObject({
      name: "Renamed",
      archived: true,
    });
    expect((await call("PATCH", `/api/sites/${site.id}`, { name: "" })).status).toBe(400);
    expect((await call("GET", "/api/sites/0000000000000000")).json).toEqual({ code: "site.not_found" });
    expect((await call("GET", "/api/sites/../../etc")).status).toBe(404);

    raw(dir, "config", "core.sshCommand", "/bin/false");
    const rechecked = await call<Site>("POST", `/api/sites/${site.id}/recheck`);
    expect(rechecked.json.readOnly).toEqual([{ code: "repo_config", where: "core.sshcommand" }]);
  });

  it("removes checkouts, its refs and its exclude block, but never the site directory", async () => {
    const { call, paths } = setup();
    const dir = starterRepo("rm-site");
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".git", "info", "exclude"), "*.mine\n");
    const site = (await call<Site>("POST", "/api/sites/import", { path: dir })).json;
    raw(dir, "update-ref", "refs/bukitjalil/changes/c1", "HEAD");
    fs.mkdirSync(path.join(paths.sessions, site.id), { recursive: true });

    const res = await call<{ leftovers: string[] }>("DELETE", `/api/sites/${site.id}`);
    expect(res.json).toEqual({ leftovers: [] });
    expect(fs.existsSync(path.join(paths.worktrees, site.id))).toBe(false);
    expect(fs.existsSync(path.join(paths.sessions, site.id))).toBe(false);
    expect(raw(dir, "for-each-ref", "refs/bukitjalil/")).toBe("");
    expect(raw(dir, "worktree", "list").trim().split("\n")).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8")).toBe("*.mine\n");
    expect(fs.existsSync(path.join(dir, "site.yaml"))).toBe(true);
    expect((await call<Site[]>("GET", "/api/sites")).json).toEqual([]);
  });

  it("reports what it could not clean in an unsafe repository", async () => {
    const { call } = setup();
    const dir = starterRepo("rm-hostile");
    const site = (await call<Site>("POST", "/api/sites/import", { path: dir })).json;
    raw(dir, "config", "core.fsmonitor", "/bin/false");
    const res = await call<{ leftovers: string[] }>("DELETE", `/api/sites/${site.id}`);
    expect(res.json.leftovers).toEqual(["worktree_registrations", "refs"]);
    expect(fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8")).not.toContain("BukitJalil");
  });

  it("removes a site whose folder is no longer a git repository", async () => {
    const { call } = setup();
    const dir = starterRepo("rm-nogit");
    const site = (await call<Site>("POST", "/api/sites/import", { path: dir })).json;
    fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
    const res = await call<{ leftovers: string[] }>("DELETE", `/api/sites/${site.id}`);
    expect(res.status).toBe(200);
    expect(res.json.leftovers).toEqual(["worktree_registrations", "refs", "exclude_block"]);
    expect((await call<Site[]>("GET", "/api/sites")).json).toEqual([]);
  });

  it("keeps the refs of change sets that belong to another site", async () => {
    const { call, db } = setup();
    const dir = starterRepo("rm-shared");
    const site = (await call<Site>("POST", "/api/sites/import", { path: dir })).json;
    const other = (await call<Site>("POST", "/api/sites/import", { path: starterRepo("rm-other") })).json;
    const head = raw(dir, "rev-parse", "HEAD").trim();
    db.prepare(
      "INSERT INTO change_sets (id, site_id, base_commit, status, created_at) VALUES (?, ?, ?, 'open', '2026-01-01')",
    ).run("theirs1", other.id, head);
    raw(dir, "update-ref", "refs/bukitjalil/changes/theirs1", "HEAD");
    raw(dir, "update-ref", "refs/bukitjalil/changes/mine1", "HEAD");
    await call("DELETE", `/api/sites/${site.id}`);
    expect(raw(dir, "for-each-ref", "--format=%(refname)", "refs/bukitjalil/").trim()).toBe(
      "refs/bukitjalil/changes/theirs1",
    );
  });

  it("answers a repository whose config stopped passing the check with site.repo_unsafe", async () => {
    const { call } = setup();
    const dir = starterRepo("hist-unsafe");
    const site = (await call<Site>("POST", "/api/sites/import", { path: dir })).json;
    raw(dir, "config", "core.fsmonitor", "/bin/false");
    const res = await call("GET", `/api/sites/${site.id}/history`);
    expect(res).toEqual({ status: 409, json: { code: "site.repo_unsafe" } });
  });

  it("answers the directory picker and identity defaults", async () => {
    const { call } = setup();
    fs.mkdirSync(path.join(userHome, "picker-dir"), { recursive: true });
    const dirs = await call<{ path: string; dirs: string[] }>("GET", "/api/fs/dirs");
    expect(dirs.json.path).toBe(userHome);
    expect(dirs.json.dirs).toContain("picker-dir");
    expect((await call("GET", "/api/fs/dirs?path=relative")).status).toBe(404);
    expect((await call("GET", "/api/git/identity")).json).toEqual({ name: "Global Name", email: "global@example.com" });
  });
});

// --- audit fixes ---

describe("site state stays safe when a check cannot finish", () => {
  it("starts a new row as not checked", () => {
    const { sites } = setup();
    sites.store.insert({ id: "00000000000000aa", name: "x", path: path.join(userHome, "row"), defaultBranch: "main" });
    expect(sites.get("00000000000000aa").readOnly).toEqual([{ code: "not_checked" }]);
  });

  it("marks a site read-only when the check fails part-way", async () => {
    const { call, paths } = setup();
    const dir = starterRepo("chk-fail");
    const site = (await call<Site>("POST", "/api/sites/import", { path: dir })).json;
    expect(site.readOnly).toBeNull();
    fs.rmSync(path.join(paths.worktrees, site.id), { recursive: true });
    fs.writeFileSync(path.join(paths.worktrees, site.id), "not a directory");
    const res = await call<Site>("POST", `/api/sites/${site.id}/recheck`);
    expect(res.status).toBe(200);
    expect(res.json.readOnly?.[0]?.code).toBe("not_checked");
    expect(res.json.checkedCommit).toBeNull();
  });

  it("reports a missing branch or directory instead of keeping the old result", async () => {
    const { call } = setup();
    const dir = starterRepo("chk-branch");
    const site = (await call<Site>("POST", "/api/sites/import", { path: dir })).json;
    raw(dir, "branch", "-q", "-m", "main", "renamed");
    expect((await call<Site>("POST", `/api/sites/${site.id}/recheck`)).json.readOnly).toEqual([
      { code: "missing_branch", where: "main" },
    ]);
    fs.renameSync(dir, `${dir}-moved`);
    expect((await call<Site>("POST", `/api/sites/${site.id}/recheck`)).json.readOnly).toEqual([
      { code: "missing_dir" },
    ]);
  });

  it("makes a broken main checkout again", async () => {
    const { call, paths } = setup();
    const dir = starterRepo("chk-broken");
    const site = (await call<Site>("POST", "/api/sites/import", { path: dir })).json;
    const checkout = path.join(paths.worktrees, site.id, "main");
    fs.rmSync(path.join(dir, ".git", "worktrees"), { recursive: true }); // registration gone, as after a re-clone
    fs.writeFileSync(path.join(checkout, "stray.txt"), "left over");
    const res = await call<Site>("POST", `/api/sites/${site.id}/recheck`);
    expect(res.json.readOnly).toBeNull();
    expect(raw(checkout, "rev-parse", "HEAD").trim()).toBe(site.checkedCommit);
    expect(fs.existsSync(path.join(checkout, "stray.txt"))).toBe(false);
  });
});

describe("import and create edge cases", () => {
  it("falls back to the folder name when site.title is not a valid name", async () => {
    const { call } = setup();
    const dir = starterRepo("imp-bidi");
    const yaml = fs.readFileSync(path.join(dir, "site.yaml"), "utf8");
    fs.writeFileSync(path.join(dir, "site.yaml"), yaml.replace(/title: .*/, 'title: "Bank\\u202eevil"'));
    commitAll(dir, "bidi title");
    expect((await call<Site>("POST", "/api/sites/import", { path: dir })).json.name).toBe("imp-bidi");
  });

  it("refuses a second site inside one that is still being added", async () => {
    const { call, identity } = setup();
    await identity();
    const outer = path.join(userHome, "race");
    const [a, b] = await Promise.all([
      call("POST", "/api/sites", { name: "Outer", path: outer, language: "en" }),
      call("POST", "/api/sites", { name: "Inner", path: path.join(outer, "inner"), language: "en" }),
    ]);
    expect(a.status).toBe(201);
    expect(b.json).toEqual({ code: "site.busy", params: { operation: "add" } });
    expect(fs.existsSync(path.join(outer, "inner"))).toBe(false);
  });
});
