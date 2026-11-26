import fs from "node:fs";
import path from "node:path";
import type { ConfigCheck, ProjectKey, SiteReason } from "@bukitjalil/shared";
import { type GuardResult, guardCommit } from "../bukit/guard.ts";
import type { BukitService } from "../bukit/locate.ts";
import { checkPassed, usableRunner } from "../bukit/runner.ts";
import { resolveBranch } from "../git/objects.ts";
import { clearIndexLock, GitError, type GitRunner, isValidBranchName } from "../git/run.ts";
import type { AppPaths } from "../paths.ts";
import { BUILD_DIRS, removeExcludeBlock, writeExcludeBlock } from "../sites/exclude.ts";
import { inside, realPathOf, SiteError } from "../sites/location.ts";
import type { Db } from "../store/db.ts";
import { rowProject } from "./owner.ts";

/** What the repository code needs to know about a project (a site or a theme project). */
export interface RepoProject {
  path: string;
  defaultBranch: string;
  configFile: string;
  readOnly: SiteReason[] | null;
}

/** The safety state of a project (plan 5.1), stored by its own table. */
export interface ProjectState {
  readOnly: SiteReason[] | null;
  checkedCommit: string | null;
  configCheck: ConfigCheck | null;
}

/** Guard result an import already computed, so registering does not scan the same commit again. */
export interface Prechecked {
  commit: string;
  guard: GuardResult;
}

export interface ProjectReposOptions {
  db: Db;
  git: GitRunner;
  paths: AppPaths;
  bukit: BukitService;
}

/**
 * The git and Bukit work every project shares (plan 5.1, 7.2; theme development design 3.2): the safety
 * evaluation, the worktrees/<project>/{main,ai} checkouts, the default branch head and removal. A site's
 * key is its id and a theme project's is themes/<id>, so each kind keeps its own directories.
 */
export class ProjectRepos {
  /** Real paths of projects being created or imported right now; they are not registered yet. */
  private readonly pending = new Set<string>();

  constructor(private readonly opts: ProjectReposOptions) {}

  /**
   * Hold `real` for a create or import until it is registered: the location rules only see registered
   * projects, so two requests in flight (for a site or a theme project) could otherwise nest.
   */
  async reserved<T>(real: string, fn: () => Promise<T>): Promise<T> {
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

  /**
   * Repository config, then the pre-build guard on the default branch, then the main/ checkout and Bukit.
   * `notionToken` is called only when the config uses Notion (sites): null when no source is bound, ""
   * when its token cannot be read; projects without Notion leave it out.
   */
  async evaluate(
    key: ProjectKey,
    project: RepoProject,
    checked?: Prechecked,
    notionToken?: () => string | null,
  ): Promise<ProjectState> {
    const unusable = (readOnly: SiteReason[], checkedCommit: string | null = null): ProjectState => ({
      readOnly,
      checkedCommit,
      configCheck: null,
    });
    if (!fs.existsSync(path.join(project.path, ".git"))) return unusable([{ code: "missing_dir" }]);
    const repoReasons = await this.repoReasons(project.path);
    if (repoReasons.length > 0) return unusable(repoReasons);
    let commit: string;
    try {
      commit = await resolveBranch(this.opts.git, project.path, project.defaultBranch);
    } catch {
      return unusable([{ code: "missing_branch", where: project.defaultBranch }]);
    }
    const guard =
      checked?.commit === commit
        ? checked.guard
        : await guardCommit(this.opts.git, project.path, commit, project.configFile);
    if (!guard.ok) return unusable(guard.reasons, commit);
    writeExcludeBlock(await this.commonDir(project.path));
    const checkout = await this.mainCheckout(key, project.path, commit);
    // The default branch is reviewed content, so a Notion site is checked with its bound token; without one
    // Bukit refuses the config, so the state says a data source must be bound.
    let configCheck: ConfigCheck;
    if (guard.usesNotion) {
      let token: string | null;
      try {
        token = notionToken ? notionToken() : null;
      } catch {
        // A token that cannot be read fails the check, not the site: builds say why when they run.
        token = "";
      }
      configCheck =
        token === null
          ? "notion"
          : token === ""
            ? "failed"
            : await this.configCheck(checkout, project.configFile, token);
    } else configCheck = await this.configCheck(checkout, project.configFile);
    return { readOnly: null, checkedCommit: commit, configCheck };
  }

  /**
   * worktrees/<project>/main at `commit`, detached; created on first use and reset afterwards (plan 7.2).
   * The caller holds the project lock: checks and builds both use this checkout.
   */
  mainCheckout(key: ProjectKey, repoPath: string, commit: string): Promise<string> {
    return this.checkout(key, repoPath, "main", commit);
  }

  /**
   * worktrees/<project>/ai, the AI's working copy (plan 6.1). Its path never changes, so a session can keep
   * using it. With `reset`, it is checked out at `commit` and cleaned (a new change set, plan 7.2);
   * without, an existing copy is left as it is and only a missing or broken one is made at `commit`.
   * Read-only projects get none. The caller holds the project lock (it runs git in the repository).
   */
  async aiWorktree(key: ProjectKey, project: RepoProject, commit: string, opts: { reset: boolean }): Promise<string> {
    if (project.readOnly) throw new SiteError("site.read_only", 409);
    const dir = this.dir(key, "ai");
    const cwd =
      !opts.reset && fs.existsSync(dir) && (await this.isCheckoutOf(dir, project.path))
        ? dir
        : await this.checkout(key, project.path, "ai", commit);
    // A project registered before the rule change need not have been rechecked before its next snapshot.
    writeExcludeBlock(await this.commonDir(cwd));
    return cwd;
  }

  /** Inspect without repairing: a failed or interrupted snapshot can leave work only in this checkout. */
  async aiCheckoutIsClean(key: ProjectKey, repoPath: string, commit: string): Promise<boolean> {
    const cwd = this.dir(key, "ai");
    const stat = fs.lstatSync(cwd, { throwIfNoEntry: false });
    if (!stat) return true;
    if (!stat.isDirectory() || !(await this.isCheckoutOf(cwd, repoPath))) return false;
    const { git } = this.opts;
    if ((await git.text(["rev-parse", "--verify", "HEAD"], { cwd })).trim() !== commit) return false;
    const status = await git.text(
      ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignored=matching", "--ignore-submodules=none"],
      { cwd },
    );
    const disposable = new Set([...BUILD_DIRS, "node_modules"].map((dir) => `!! ${dir}/`));
    return status.split("\0").every((entry) => entry === "" || disposable.has(entry));
  }

  /** Commit at the head of the project's default branch, with API errors for the ways that fails. */
  async headOf(project: RepoProject): Promise<string> {
    try {
      return await resolveBranch(this.opts.git, project.path, project.defaultBranch);
    } catch (err) {
      if (err instanceof GitError && (err.kind === "unsafe_repo" || err.kind === "dubious_ownership")) {
        throw new SiteError("site.repo_unsafe", 409);
      }
      if (err instanceof GitError && err.kind === "failed") {
        throw new SiteError("site.branch_missing", 409, { branch: project.defaultBranch });
      }
      throw err;
    }
  }

  /** The default branch name must be one git accepts and not look like an option (plan 5.1). */
  async assertBranch(branch: string, cwd: string): Promise<void> {
    if (!(await isValidBranchName(this.opts.git, branch, cwd))) throw new SiteError("site.bad_branch", 400);
  }

  private dir(key: ProjectKey, name: "ai" | "main"): string {
    return path.join(this.opts.paths.worktrees, key, name);
  }

  /** worktrees/<project>/<name> at `commit`, detached: made when missing or broken, otherwise reset. */
  private async checkout(key: ProjectKey, repoPath: string, name: "ai" | "main", commit: string): Promise<string> {
    const { git } = this.opts;
    const dir = this.dir(key, name);
    // A checkout left half-made, or whose registration is gone (the repository was re-cloned), is made
    // again instead of failing every check from now on.
    if (fs.existsSync(dir) && !(await this.isCheckoutOf(dir, repoPath)))
      fs.rmSync(dir, { recursive: true, force: true });
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
        // --force replaces the missing registration at this exact path; prune would affect every worktree.
        await git.run(["worktree", "add", "-q", "--force", "--detach", dir, commit], { cwd: repoPath });
      } else {
        await git.run(["checkout", "-q", "--detach", "--force", commit], { cwd: dir });
        await git.run(["clean", "-q", "-fdx", "-e", ".bukit", "-e", ".cache"], { cwd: dir });
      }
    } catch (err) {
      if (err instanceof GitError && err.kind === "timeout") await clearIndexLock(git, dir);
      throw err;
    }
    return dir;
  }

  /** `dir` is a linked worktree of the repository at `repoPath` with its own .git file. */
  private async isCheckoutOf(dir: string, repoPath: string): Promise<boolean> {
    if (!fs.lstatSync(path.join(dir, ".git"), { throwIfNoEntry: false })?.isFile()) return false;
    try {
      const out = await this.opts.git.text(
        ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"],
        { cwd: dir, repoCheck: false },
      );
      const [top, common] = splitLines(out);
      if (!top || !common) return false;
      return (
        fs.realpathSync.native(top) === fs.realpathSync.native(dir) &&
        fs.realpathSync.native(common) === fs.realpathSync.native(await this.commonDir(repoPath))
      );
    } catch {
      return false;
    }
  }

  private async configCheck(checkout: string, configFile: string, notionToken?: string): Promise<ConfigCheck> {
    const runner = await usableRunner(this.opts.bukit, {
      git: this.opts.git,
      home: this.opts.paths.home,
      tmpDir: this.opts.paths.bukitTmp,
    });
    if (!runner) return "not_run";
    const env = notionToken === undefined ? {} : { env: { NOTION_TOKEN: notionToken } };
    return checkPassed(
      await runner.run("check", ["config", "check", "--config", configFile], { cwd: checkout, ...env }),
    )
      ? "ok"
      : "failed";
  }

  /**
   * Remove what BukitJalil keeps for a project (plan 9.1 DELETE): its checkouts, refs/bukitjalil/* of its
   * own change sets, the exclude block, sessions and previews. The project directory itself is never
   * deleted. Steps that need git are skipped for a repository that fails the config check; they are
   * returned as `leftovers`. `otherPaths` are the directories of every other registered project: one that
   * shares the repository keeps the exclude block. The caller holds the project lock.
   */
  async removeFiles(key: ProjectKey, project: RepoProject, otherPaths: string[]): Promise<string[]> {
    const { git } = this.opts;
    const leftovers: string[] = [];
    fs.rmSync(path.join(this.opts.paths.worktrees, key), { recursive: true, force: true });
    // A folder that is no longer a git repository (or fails the check) only leaves leftovers: removal must
    // always succeed, since that is what the user does about such a project.
    const repoOk =
      fs.existsSync(project.path) && (await this.repoReasons(project.path).catch(() => null))?.length === 0;
    if (repoOk) {
      // Another registered project can share this repository (a linked worktree): its change refs stay.
      const owner = this.opts.db.prepare("SELECT site_id, theme_id FROM change_sets WHERE id = ?");
      const refs = splitLines(
        await git.text(["for-each-ref", "--format=%(refname)", "refs/bukitjalil/"], { cwd: project.path }),
      ).filter((ref) => {
        const row = owner.get(ref.slice(ref.lastIndexOf("/") + 1)) as
          | { site_id: string | null; theme_id: string | null }
          | undefined;
        return !row || rowProject(row) === key;
      });
      for (const ref of refs) await git.run(["update-ref", "-d", ref], { cwd: project.path });
      const registered = await git.text(["worktree", "list", "--porcelain", "-z"], { cwd: project.path });
      const root = path.join(realPathOf(this.opts.paths.worktrees), key);
      const owned = new Set([path.join(root, "main"), path.join(root, "ai")]);
      for (const record of registered.split("\0\0")) {
        const [field, ...attributes] = record.split("\0");
        if (!field?.startsWith("worktree ")) continue;
        const dir = path.normalize(field.slice("worktree ".length));
        if (!owned.has(dir)) continue;
        if (attributes.some((attr) => attr === "locked" || attr.startsWith("locked "))) {
          if (!leftovers.includes("worktree_registrations")) leftovers.push("worktree_registrations");
        } else await git.run(["worktree", "remove", "--", dir], { cwd: project.path });
      }
    } else {
      leftovers.push("worktree_registrations", "refs");
    }
    // A .git link may point at another repository; never write its exclude block through it.
    const common =
      !gitSymlink(project.path) && fs.existsSync(project.path)
        ? await this.commonDir(project.path).catch(() => null)
        : null;
    // The block is shared too: it stays while another registered project uses the same repository.
    const shared =
      common !== null &&
      (
        await Promise.all(otherPaths.filter((p) => fs.existsSync(p)).map((p) => this.commonDir(p).catch(() => null)))
      ).includes(common);
    if (common && !shared) removeExcludeBlock(common);
    else if (!common) leftovers.push("exclude_block");
    fs.rmSync(path.join(this.opts.paths.previews, key), { recursive: true, force: true });
    return leftovers;
  }

  // --- git helpers ---

  /** Repository config allowlist result (plan 7.3) as reasons; [] when the repository is acceptable. */
  async repoReasons(cwd: string): Promise<SiteReason[]> {
    if (gitSymlink(cwd)) return [{ code: "git_symlink" }];
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
  async toplevel(dir: string): Promise<string | null> {
    try {
      // Upward on purpose: a folder inside a repository is reported as not its root.
      return (
        await this.opts.git.text(["rev-parse", "--show-toplevel"], { cwd: dir, repoCheck: false, discover: true })
      ).trim();
    } catch (err) {
      if (err instanceof GitError && err.kind === "dubious_ownership") return "dubious";
      if (err instanceof GitError && /not a git repository/i.test(err.details.stderr ?? "")) return null;
      throw err;
    }
  }

  /** Current branch (plan 5.1): `symbolic-ref` only reads HEAD, so it is safe even before the config check. */
  async currentBranch(dir: string): Promise<string> {
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
    await this.assertBranch(ref, dir);
    return ref;
  }

  /**
   * Make the repository of a newly written project at `real` (plan 5.2): `main`, the exclude block, and one
   * commit with every file. -b main because global config (init.defaultBranch) is not read.
   */
  async commitNew(real: string, identity: Record<string, string>, message: string): Promise<void> {
    const { git } = this.opts;
    await git.run(["init", "-q", "-b", "main"], { cwd: real, repoCheck: false });
    writeExcludeBlock(await this.commonDir(real));
    await git.run(["add", "-A"], { cwd: real });
    await git.run(["commit", "-q", "--no-verify", "-m", message], { cwd: real, config: identity });
  }

  async commonDir(cwd: string): Promise<string> {
    const out = await this.opts.git.text(["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      repoCheck: false,
    });
    return out.trim();
  }
}

/** A .git link can point the repository at another folder; never read or write through it. */
export const gitSymlink = (dir: string): boolean =>
  fs.lstatSync(path.join(dir, ".git"), { throwIfNoEntry: false })?.isSymbolicLink() === true;

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

const splitLines = (out: string) => out.split("\n").filter((s) => s.length > 0);
