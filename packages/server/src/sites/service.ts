import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  type ConfigCheck,
  type CreateSiteRequest,
  type ImportInspection,
  type ImportSiteRequest,
  type Site,
  SiteName,
  type SitePatch,
  type SiteReason,
} from "@bukitjalil/shared";
import { parseDocument } from "yaml";
import { type GuardResult, guardCommit } from "../bukit/guard.ts";
import type { BukitService } from "../bukit/locate.ts";
import { checkPassed, usableRunner } from "../bukit/runner.ts";
import { resolveBranch } from "../git/objects.ts";
import { GitError, type GitRunner, isValidBranchName } from "../git/run.ts";
import type { AppPaths } from "../paths.ts";
import type { SettingsStore } from "../store/settings.ts";
import { EXCLUDE_PATTERNS, IMPORT_INIT_PATTERNS, removeExcludeBlock, writeExcludeBlock } from "./exclude.ts";
import { assertDirectory, assertEmptyOrMissing, checkSiteLocation, inside, SiteError } from "./location.ts";
import type { SiteLocks } from "./locks.ts";
import { isSiteId, newSiteId, type SiteState, SiteStore } from "./store.ts";
import { copyStarter } from "./template.ts";

export interface SiteServiceOptions {
  db: DatabaseSync;
  git: GitRunner;
  paths: AppPaths;
  settings: SettingsStore;
  bukit: BukitService;
  locks: SiteLocks;
  /** templates/starter */
  templateDir: string;
  /** Overrides os.homedir() (tests). */
  userHome?: string;
}

const INITIAL_MESSAGE = "Initial site from BukitJalil starter";
const IMPORT_MESSAGE = "Initial commit from BukitJalil import";
const MAX_IMPORT_FILES = 100_000;

/** Guard result an import already computed, so registering does not scan the same commit again. */
interface Prechecked {
  commit: string;
  guard: GuardResult;
}

/**
 * Sites (plan 5.1, 5.2): create from the starter, import an existing directory, safety state, removal.
 * A site that fails the repository or pre-build checks is kept but read-only: no checkout is created and
 * Bukit is never run for it.
 */
export class SiteService {
  readonly store: SiteStore;
  /** Real paths of sites being created or imported right now; they are not in the store yet. */
  private readonly pending = new Set<string>();
  private readonly addedHooks: ((site: Site) => Promise<void>)[] = [];
  private readonly removingHooks: ((siteId: string) => Promise<void>)[] = [];

  constructor(private readonly opts: SiteServiceOptions) {
    this.store = new SiteStore(opts.db);
  }

  list(): Site[] {
    return this.store.list();
  }

  /** Run `hook` after a site is created or imported and checked (the build service starts its first build). */
  onAdded(hook: (site: Site) => Promise<void>): void {
    this.addedHooks.push(hook);
  }

  /** Run `hook` before a site's files are removed (the agent service stops and closes its sessions). */
  onRemoving(hook: (siteId: string) => Promise<void>): void {
    this.removingHooks.push(hook);
  }

  private async added(site: Site): Promise<Site> {
    for (const hook of this.addedHooks) await hook(site);
    return site;
  }

  /**
   * Record what a build's pre-build guard found for `commit` (plan 8.5): a refused commit makes the site
   * read-only, a Notion source shows as configCheck "notion". The caller holds the site lock.
   */
  applyGuard(id: string, commit: string, guard: GuardResult): void {
    if (!guard.ok) this.store.setState(id, { readOnly: guard.reasons, checkedCommit: commit, configCheck: null });
    else if (guard.usesNotion)
      this.store.setState(id, { readOnly: null, checkedCommit: commit, configCheck: "notion" });
  }

  get(id: string): Site {
    const site = isSiteId(id) ? this.store.get(id) : null;
    if (!site) throw new SiteError("site.not_found", 404);
    return site;
  }

  private rules() {
    return { appHome: this.opts.paths.home, userHome: this.opts.userHome, sites: this.store.list() };
  }

  private identity(): Record<string, string> {
    const { commitName, commitEmail } = this.opts.settings.get();
    if (!commitName || !commitEmail) throw new SiteError("site.identity_required", 400);
    return { "user.name": commitName, "user.email": commitEmail };
  }

  /**
   * Hold `real` for a create or import until it is registered: the location rules only see registered
   * sites, so two requests in flight could otherwise put one site inside the other.
   */
  private async reserved<T>(real: string, fn: () => Promise<T>): Promise<T> {
    for (const other of this.pending) {
      if (inside(real, other) || inside(other, real)) throw new SiteError("site.busy", 409, { operation: "add" });
    }
    this.pending.add(real);
    try {
      return await fn();
    } finally {
      this.pending.delete(real);
    }
  }

  // --- create (plan 5.2) ---

  async create(req: CreateSiteRequest): Promise<Site> {
    const identity = this.identity();
    const real = checkSiteLocation(req.path, this.rules());
    const site = await this.reserved(real, async () => {
      assertEmptyOrMissing(real);
      const existed = fs.existsSync(real);
      copyStarter(this.opts.templateDir, real, { title: req.name, language: req.language });
      try {
        const { git } = this.opts;
        // -b main: global config (init.defaultBranch) is not read, so git would pick "master".
        await git.run(["init", "-q", "-b", "main"], { cwd: real, repoCheck: false });
        writeExcludeBlock(await this.commonDir(real));
        await git.run(["add", "-A"], { cwd: real });
        await git.run(["commit", "-q", "--no-verify", "-m", INITIAL_MESSAGE], { cwd: real, config: identity });
      } catch (err) {
        removeCreated(real, existed);
        throw err;
      }
      return this.register(real, req.name, "main");
    });
    return this.added(site);
  }

  // --- import (plan 5.1) ---

  /** Read-only look at a directory: nothing is written and Bukit is not run. */
  async inspectImport(target: string): Promise<ImportInspection> {
    return (await this.inspect(target)).inspection;
  }

  private async inspect(target: string): Promise<{ inspection: ImportInspection; checked?: Prechecked }> {
    const real = checkSiteLocation(target, this.rules());
    assertDirectory(real);
    const siteYaml = path.join(real, "site.yaml");
    if (!fs.existsSync(siteYaml) || !fs.lstatSync(siteYaml).isFile()) throw new SiteError("site.no_site_yaml", 400);

    const top = await this.toplevel(real);
    if (top === null) return { inspection: { kind: "not_git", path: real, files: await this.filesForInit(real) } };
    // git does not say where a repository it refuses starts, so require .git right here.
    const isRoot = top === "dubious" ? fs.existsSync(path.join(real, ".git")) : fs.realpathSync(top) === real;
    if (!isRoot) throw new SiteError("site.not_repo_root", 400);

    const branch = await this.currentBranch(real);
    const repoReasons = await this.repoReasons(real);
    if (repoReasons.length > 0) return { inspection: { kind: "git", path: real, branch, readOnly: repoReasons } };

    let commit: string;
    try {
      commit = await resolveBranch(this.opts.git, real, branch);
    } catch {
      throw new SiteError("site.no_commits", 400);
    }
    const status = await this.opts.git.text(["status", "--porcelain=v1", "-z", "--untracked-files=no"], { cwd: real });
    if (status.length > 0) throw new SiteError("site.dirty", 409);
    const guard = await guardCommit(this.opts.git, real, commit);
    return {
      inspection: { kind: "git", path: real, branch, readOnly: guard.ok ? null : guard.reasons },
      checked: { commit, guard },
    };
  }

  async import(req: ImportSiteRequest): Promise<Site> {
    const real = checkSiteLocation(req.path, this.rules());
    const site = await this.reserved(real, async () => {
      const { inspection, checked } = await this.inspect(real);
      const name = req.name ?? siteTitle(real) ?? path.basename(real);
      if (inspection.kind === "git") return this.register(real, name, inspection.branch, checked);
      if (!req.initGit) throw new SiteError("site.not_git", 409);
      await this.initForImport(real, req.initGit.files, this.identity());
      return this.register(real, name, "main");
    });
    return this.added(site);
  }

  /** `git init` an existing directory after the user confirmed exactly which files go into the first commit. */
  private async initForImport(real: string, confirmed: string[], identity: Record<string, string>) {
    const { git } = this.opts;
    // Rolling back removes .git, so it must be ours: refuse if one appeared since the inspection.
    if (fs.existsSync(path.join(real, ".git"))) throw new SiteError("site.file_list_changed", 409);
    try {
      await git.run(["init", "-q", "-b", "main"], { cwd: real, repoCheck: false });
      // The exclude block goes in first: once dist/, .bukit/ or .env are tracked, ignoring no longer helps.
      writeExcludeBlock(await this.commonDir(real), [...EXCLUDE_PATTERNS, ...IMPORT_INIT_PATTERNS]);
      await git.run(["add", "-A"], { cwd: real });
      const staged = splitZ(await git.text(["ls-files", "-z"], { cwd: real }));
      if (!sameSet(staged, confirmed)) throw new SiteError("site.file_list_changed", 409);
      await git.run(["commit", "-q", "--no-verify", "-m", IMPORT_MESSAGE], { cwd: real, config: identity });
    } catch (err) {
      // Only .git was created; the user's files were never touched.
      fs.rmSync(path.join(real, ".git"), { recursive: true, force: true });
      throw err;
    }
  }

  /**
   * Files a first commit would contain, computed without touching the directory: a scratch git dir in the
   * app's tmp with the same exclude patterns lists the untracked, not-ignored files of the work tree.
   */
  private async filesForInit(real: string): Promise<string[]> {
    fs.mkdirSync(this.opts.paths.tmp, { recursive: true, mode: 0o700 });
    const scratch = fs.mkdtempSync(path.join(this.opts.paths.tmp, "inspect-"));
    try {
      const { git } = this.opts;
      await git.run(["init", "-q", "--bare", scratch], { cwd: this.opts.paths.tmp, repoCheck: false });
      fs.writeFileSync(
        path.join(scratch, "info", "exclude"),
        `${[...EXCLUDE_PATTERNS, ...IMPORT_INIT_PATTERNS].join("\n")}\n`,
      );
      const out = await git.text(
        [`--git-dir=${scratch}`, `--work-tree=${real}`, "ls-files", "-o", "--exclude-standard", "-z"],
        { cwd: real, repoCheck: false, maxOutputBytes: 64 * 1024 * 1024 },
      );
      const files = splitZ(out);
      // An embedded repository shows up as "dir/"; committing it would add a gitlink, not its files.
      const nested = files.find((f) => f.endsWith("/"));
      if (nested) throw new SiteError("site.nested_repo", 400, { path: nested.slice(0, -1) });
      if (files.length > MAX_IMPORT_FILES) {
        throw new SiteError("site.too_many_files", 400, { max: String(MAX_IMPORT_FILES) });
      }
      return files.sort();
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  // --- shared by create and import ---

  private async register(real: string, name: string, defaultBranch: string, checked?: Prechecked): Promise<Site> {
    if (!(await isValidBranchName(this.opts.git, defaultBranch, real))) throw new SiteError("site.bad_branch", 400);
    const id = newSiteId();
    try {
      this.store.insert({ id, name, path: real, defaultBranch });
    } catch (err) {
      if (/UNIQUE/i.test((err as Error).message)) throw new SiteError("site.already_registered", 409);
      throw err;
    }
    this.opts.settings.update({ lastParentDir: path.dirname(real) });
    return this.check(id, checked);
  }

  /** Run the safety checks again (`POST /recheck`), e.g. after the user fixed what made the site read-only. */
  recheck(id: string): Promise<Site> {
    return this.check(id);
  }

  /**
   * Re-evaluate a site (plan 5.1 steps 2–4). The site stays usable only if every step finishes: a check
   * that fails part-way leaves it read-only with "not_checked" rather than keeping an older result.
   */
  private async check(id: string, checked?: Prechecked): Promise<Site> {
    const site = this.get(id);
    await this.opts.locks.run(id, "recheck", async () => {
      let state: SiteState;
      try {
        state = await this.evaluate(id, site, checked);
      } catch (err) {
        const detail = err instanceof Error ? err.message.slice(0, 500) : String(err);
        state = { readOnly: [{ code: "not_checked", detail }], checkedCommit: null, configCheck: null };
      }
      this.store.setState(id, state);
    });
    return this.get(id);
  }

  /** Repository config, then the pre-build guard on the default branch, then the main/ checkout and Bukit. */
  private async evaluate(id: string, site: Site, checked?: Prechecked): Promise<SiteState> {
    const unusable = (readOnly: SiteReason[], checkedCommit: string | null = null): SiteState => ({
      readOnly,
      checkedCommit,
      configCheck: null,
    });
    if (!fs.existsSync(path.join(site.path, ".git"))) return unusable([{ code: "missing_dir" }]);
    const repoReasons = await this.repoReasons(site.path);
    if (repoReasons.length > 0) return unusable(repoReasons);
    let commit: string;
    try {
      commit = await resolveBranch(this.opts.git, site.path, site.defaultBranch);
    } catch {
      return unusable([{ code: "missing_branch", where: site.defaultBranch }]);
    }
    const guard = checked?.commit === commit ? checked.guard : await guardCommit(this.opts.git, site.path, commit);
    if (!guard.ok) return unusable(guard.reasons, commit);
    writeExcludeBlock(await this.commonDir(site.path));
    const checkout = await this.mainCheckout(id, site.path, commit);
    const configCheck = guard.usesNotion ? "notion" : await this.configCheck(checkout);
    return { readOnly: null, checkedCommit: commit, configCheck };
  }

  /**
   * worktrees/<siteId>/main at `commit`, detached; created on first use and reset afterwards (plan 7.2).
   * The caller holds the site lock: checks and builds both use this checkout.
   */
  mainCheckout(id: string, sitePath: string, commit: string): Promise<string> {
    return this.checkout(id, sitePath, "main", commit);
  }

  /**
   * worktrees/<siteId>/ai, the AI's working copy (plan 6.1). Its path never changes, so a session can keep
   * using it. Made at the head of the default branch when missing; an existing copy is left as it is
   * (resetting it belongs to change sets, plan 7.2). Read-only sites get none. Making it runs git in the
   * site repository, so it takes the site lock like builds and removal do (site.busy while they run).
   */
  async aiCheckout(id: string): Promise<string> {
    const site = this.get(id);
    if (site.readOnly) throw new SiteError("site.read_only", 409);
    const dir = path.join(this.opts.paths.worktrees, id, "ai");
    if (fs.existsSync(dir) && (await this.isCheckoutOf(dir, site.path))) return dir;
    return this.opts.locks.run(id, "ai_checkout", async () => {
      // The site may have been removed or become read-only while the lock was free.
      const current = this.get(id);
      if (current.readOnly) throw new SiteError("site.read_only", 409);
      return this.checkout(id, current.path, "ai", await this.headOf(current));
    });
  }

  /** Commit at the head of the site's default branch, with API errors for the ways that fails. */
  async headOf(site: Site): Promise<string> {
    try {
      return await resolveBranch(this.opts.git, site.path, site.defaultBranch);
    } catch (err) {
      if (err instanceof GitError && (err.kind === "unsafe_repo" || err.kind === "dubious_ownership")) {
        throw new SiteError("site.repo_unsafe", 409);
      }
      if (err instanceof GitError && err.kind === "failed") {
        throw new SiteError("site.branch_missing", 409, { branch: site.defaultBranch });
      }
      throw err;
    }
  }

  /** worktrees/<siteId>/<name> at `commit`, detached: made when missing or broken, otherwise reset. */
  private async checkout(id: string, sitePath: string, name: "ai" | "main", commit: string): Promise<string> {
    const { git } = this.opts;
    const dir = path.join(this.opts.paths.worktrees, id, name);
    // A checkout left half-made, or whose registration is gone (the site repository was re-cloned), is
    // made again instead of failing every check from now on.
    if (fs.existsSync(dir) && !(await this.isCheckoutOf(dir, sitePath)))
      fs.rmSync(dir, { recursive: true, force: true });
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
      await git.run(["worktree", "prune"], { cwd: sitePath });
      await git.run(["worktree", "add", "-q", "--detach", dir, commit], { cwd: sitePath });
    } else {
      await git.run(["checkout", "-q", "--detach", "--force", commit], { cwd: dir });
      await git.run(["clean", "-q", "-fdx", "-e", ".bukit", "-e", ".cache"], { cwd: dir });
    }
    return dir;
  }

  /** `dir` is a linked worktree of the site repository with its own .git file. */
  private async isCheckoutOf(dir: string, sitePath: string): Promise<boolean> {
    if (!fs.lstatSync(path.join(dir, ".git"), { throwIfNoEntry: false })?.isFile()) return false;
    try {
      const out = await this.opts.git.text(
        ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"],
        { cwd: dir, repoCheck: false },
      );
      const [top, common] = splitLines(out);
      if (!top || !common) return false;
      return (
        fs.realpathSync(top) === fs.realpathSync(dir) &&
        fs.realpathSync(common) === fs.realpathSync(await this.commonDir(sitePath))
      );
    } catch {
      return false;
    }
  }

  private async configCheck(checkout: string): Promise<ConfigCheck> {
    const runner = await usableRunner(this.opts.bukit, {
      git: this.opts.git,
      home: this.opts.paths.home,
      tmpDir: this.opts.paths.bukitTmp,
    });
    if (!runner) return "not_run";
    return checkPassed(await runner.run("check", ["config", "check"], { cwd: checkout })) ? "ok" : "failed";
  }

  // --- patch / remove ---

  patch(id: string, patch: SitePatch): Site {
    this.get(id);
    this.store.patch(id, patch);
    return this.get(id);
  }

  touch(id: string): void {
    this.get(id);
    this.store.touch(id);
  }

  /**
   * Remove a site from BukitJalil (plan 9.1 DELETE): its checkouts, refs/bukitjalil/*, the exclude block,
   * sessions and previews. The site directory itself is never deleted. Steps that need git are skipped for
   * a repository that fails the config check; they are returned as `leftovers`.
   */
  async remove(id: string): Promise<{ leftovers: string[] }> {
    const site = this.get(id);
    return this.opts.locks.run(id, "remove", async () => {
      const { git } = this.opts;
      const leftovers: string[] = [];
      for (const hook of this.removingHooks) await hook(id);
      fs.rmSync(path.join(this.opts.paths.worktrees, id), { recursive: true, force: true });
      const repoOk = fs.existsSync(site.path) && (await this.repoReasons(site.path)).length === 0;
      if (repoOk) {
        const refs = splitLines(
          await git.text(["for-each-ref", "--format=%(refname)", "refs/bukitjalil/"], { cwd: site.path }),
        );
        for (const ref of refs) await git.run(["update-ref", "-d", ref], { cwd: site.path });
        await git.run(["worktree", "prune"], { cwd: site.path });
      } else {
        leftovers.push("worktree_registrations", "refs");
      }
      const common = fs.existsSync(site.path) ? await this.commonDir(site.path).catch(() => null) : null;
      if (common) removeExcludeBlock(common);
      else leftovers.push("exclude_block");
      fs.rmSync(path.join(this.opts.paths.sessions, id), { recursive: true, force: true });
      fs.rmSync(path.join(this.opts.paths.previews, id), { recursive: true, force: true });
      this.store.delete(id);
      return { leftovers };
    });
  }

  // --- git helpers ---

  /** Repository config allowlist result (plan 7.3) as site reasons; [] when the repository is acceptable. */
  private async repoReasons(cwd: string): Promise<SiteReason[]> {
    try {
      const check = await this.opts.git.checkRepo(cwd);
      return check.reasons.map((r) =>
        r.startsWith("config:")
          ? { code: "repo_config", where: r.slice("config:".length) }
          : { code: "lfs", where: ".git/info/attributes" },
      );
    } catch (err) {
      if (err instanceof GitError && err.kind === "dubious_ownership") return [{ code: "dubious_ownership" }];
      throw err;
    }
  }

  /** Top level of the repository containing `dir`; null when it is not in one; "dubious" when git refuses it. */
  private async toplevel(dir: string): Promise<string | null> {
    try {
      return (await this.opts.git.text(["rev-parse", "--show-toplevel"], { cwd: dir, repoCheck: false })).trim();
    } catch (err) {
      if (err instanceof GitError && err.kind === "dubious_ownership") return "dubious";
      if (err instanceof GitError && /not a git repository/i.test(err.details.stderr ?? "")) return null;
      throw err;
    }
  }

  /** Current branch (plan 5.1): `symbolic-ref` only reads HEAD, so it is safe even before the config check. */
  private async currentBranch(dir: string): Promise<string> {
    let ref: string;
    try {
      ref = (
        await this.opts.git.text(["symbolic-ref", "-q", "--short", "HEAD"], {
          cwd: dir,
          repoCheck: false,
          okCodes: [1],
        })
      ).trim();
    } catch (err) {
      if (!(err instanceof GitError && err.kind === "dubious_ownership")) throw err;
      ref = readHeadFile(dir) ?? "";
    }
    if (ref === "") throw new SiteError("site.detached_head", 400);
    if (!(await isValidBranchName(this.opts.git, ref, dir))) throw new SiteError("site.bad_branch", 400);
    return ref;
  }

  private async commonDir(cwd: string): Promise<string> {
    const out = await this.opts.git.text(["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      repoCheck: false,
    });
    return out.trim();
  }
}

/** site.title from site.yaml, as the default display name of an imported site. */
function siteTitle(dir: string): string | null {
  try {
    const doc = parseDocument(fs.readFileSync(path.join(dir, "site.yaml"), "utf8"), { schema: "failsafe" });
    const title = doc.getIn(["site", "title"]);
    // The same rules as a name typed in the UI: no control or bidi characters.
    const parsed = typeof title === "string" ? SiteName.safeParse(title) : null;
    return parsed?.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** HEAD of a repository git refuses to open (dubious ownership): "ref: refs/heads/<branch>". */
function readHeadFile(dir: string): string | null {
  try {
    let gitDir = path.join(dir, ".git");
    if (fs.statSync(gitDir).isFile()) {
      // A linked worktree or submodule: ".git" is a file holding "gitdir: <path>".
      const match = /^gitdir: (.+)$/m.exec(fs.readFileSync(gitDir, "utf8"));
      if (!match?.[1]) return null;
      gitDir = path.resolve(dir, match[1].trim());
    }
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    return head.startsWith("ref: refs/heads/") ? head.slice("ref: refs/heads/".length) : null;
  } catch {
    return null;
  }
}

/** Undo a failed create: remove the directory, or only its contents when it existed (empty) before. */
function removeCreated(dir: string, existed: boolean): void {
  if (!existed) {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
}

const splitZ = (out: string) => out.split("\0").filter((s) => s.length > 0);
const splitLines = (out: string) => out.split("\n").filter((s) => s.length > 0);
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}
