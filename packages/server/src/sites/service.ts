import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  type ConfigCheck,
  type CreateSiteRequest,
  type ImportInspection,
  type ImportSiteRequest,
  type LanguageMigrationResponse,
  type Site,
  SiteName,
  type SitePatch,
  type SiteReason,
} from "@bukitjalil/shared";
import { parseDocument } from "yaml";
import { type GuardResult, guardCommit } from "../bukit/guard.ts";
import type { BukitService } from "../bukit/locate.ts";
import { checkPassed, usableRunner } from "../bukit/runner.ts";
import type { DataSourceService } from "../data-sources/service.ts";
import { readBlobAt, resolveBranch } from "../git/objects.ts";
import { clearIndexLock, GitError, type GitRunner, isValidBranchName } from "../git/run.ts";
import type { AppPaths } from "../paths.ts";
import type { SettingsStore } from "../store/settings.ts";
import { type ConfigCommitCodes, commitSiteYaml } from "./config-commit.ts";
import { EXCLUDE_PATTERNS, IMPORT_INIT_PATTERNS, removeExcludeBlock, writeExcludeBlock } from "./exclude.ts";
import { planLanguageMigration, siteYamlPatch } from "./language-migration.ts";
import { assertDirectory, assertEmptyOrMissing, checkSiteLocation, inside, SiteError } from "./location.ts";
import type { SiteLocks } from "./locks.ts";
import { isSiteId, newSiteId, type SiteState, SiteStore } from "./store.ts";
import { copyStarter, type StarterSource } from "./template.ts";

export interface SiteServiceOptions {
  db: DatabaseSync;
  git: GitRunner;
  paths: AppPaths;
  settings: SettingsStore;
  bukit: BukitService;
  locks: SiteLocks;
  /** Optional saved Notion source copied into a new site. */
  dataSources: DataSourceService;
  /** templates/starter */
  templateDir: string;
  /** Overrides os.homedir() (tests). */
  userHome?: string;
}

const INITIAL_MESSAGE = "Initial site from BukitJalil starter";
const MAX_SITE_YAML = 1024 * 1024;
/** Errors of the language migration commit (plan 8.7), worded for its card. */
const LANGUAGE_CODES: ConfigCommitCodes = {
  wrongBranch: "language.wrong_branch",
  dirty: "language.dirty",
  changed: "language.commit_changed",
  failed: "language.failed",
};
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
    // "notion" means the site has no bound data source; a bound one keeps its last config check result.
    else if (guard.usesNotion && this.store.notionDataSourceId(id) === null)
      this.store.setState(id, { readOnly: null, checkedCommit: commit, configCheck: "notion" });
  }

  /**
   * The Notion token of the data source bound to the site, or null when none is bound (plan 7 key rules).
   * Never another saved source: an imported site's site.yaml could name any database that token reads.
   * Only reviewed content on the default branch may run Bukit with it.
   */
  notionToken(id: string): string | null {
    const linked = this.store.notionDataSourceId(id);
    return linked ? this.opts.dataSources.token(linked) : null;
  }

  get(id: string): Site {
    const site = isSiteId(id) ? this.store.get(id) : null;
    if (!site) throw new SiteError("site.not_found", 404);
    return site;
  }

  private rules() {
    return { appHome: this.opts.paths.home, userHome: this.opts.userHome, sites: this.store.list() };
  }

  /** The saved Notion source bound to the site, if any (set at creation or with bindNotionSource). */
  notionDataSourceId(id: string): string | null {
    return this.store.notionDataSourceId(id);
  }

  /** Which saved publishing account the site deploys with, if any. */
  publishAccountId(id: string): string | null {
    return this.store.publishAccountId(id);
  }

  setPublishAccountId(id: string, accountId: string | null): void {
    this.store.setPublishAccountId(id, accountId);
  }

  /** The commit identity from the settings, as git config (400 `site.identity_required` when unset). */
  commitIdentity(): { "user.name": string; "user.email": string } {
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
    const identity = this.commitIdentity();
    const real = checkSiteLocation(req.path, this.rules());
    const selected = this.selectedSources(req);
    const site = await this.reserved(real, async () => {
      assertEmptyOrMissing(real);
      const existed = fs.existsSync(real);
      copyStarter(this.opts.templateDir, real, { title: req.name, language: req.language, sources: selected?.sources });
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
      return this.register(real, req.name, "main", undefined, selected?.notionDataSourceId ?? null);
    });
    return this.added(site);
  }

  /**
   * The optional Notion source chosen for a new site. Without one site.yaml keeps the starter's
   * Markdown sources; with one the site uses the picked databases, each in the role the user chose.
   */
  private selectedSources(req: CreateSiteRequest): { sources: StarterSource[]; notionDataSourceId: string } | null {
    const ids = [...new Set(req.dataSourceIds ?? [])];
    if (ids.length === 0) return null;
    const id = ids[0];
    if (ids.length > 1 || !id) throw new SiteError("datasource.multiple_notion", 400);
    const source = this.opts.dataSources.get(id);
    const picks = req.notionDatabases ?? [];
    if (picks.length === 0) throw new SiteError("datasource.notion_database_required", 400);
    const seen = new Set<string>();
    const names = new Set<string>();
    const sources: StarterSource[] = [];
    for (const pick of picks) {
      if (seen.has(pick.databaseId)) continue;
      seen.add(pick.databaseId);
      sources.push({
        type: "notion",
        name: uniqueSourceName(pick.title, names),
        ...(pick.use === "data" ? { mode: "data" as const } : { mode: "content" as const, collection: pick.use }),
        notion: { databaseId: pick.databaseId },
      });
    }
    return { sources, notionDataSourceId: source.id };
  }

  // --- import (plan 5.1) ---

  /** Read-only look at a directory: nothing is written and Bukit is not run. */
  async inspectImport(target: string): Promise<ImportInspection> {
    return (await this.inspect(target)).inspection;
  }

  private async inspect(target: string): Promise<{ inspection: ImportInspection; checked?: Prechecked }> {
    const real = checkSiteLocation(target, this.rules());
    assertDirectory(real);
    assertNoGitSymlink(real);
    const siteYaml = path.join(real, "site.yaml");
    if (!fs.existsSync(siteYaml) || !fs.lstatSync(siteYaml).isFile()) throw new SiteError("site.no_site_yaml", 400);

    const top = await this.toplevel(real);
    if (top === null) return { inspection: { kind: "not_git", path: real, files: await this.filesForInit(real) } };
    // git does not say where a repository it refuses starts, so require .git right here.
    const isRoot = top === "dubious" ? fs.existsSync(path.join(real, ".git")) : fs.realpathSync.native(top) === real;
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
      await this.initForImport(real, req.initGit.files, this.commitIdentity());
      return this.register(real, name, "main");
    });
    return this.added(site);
  }

  /** `git init` an existing directory after the user confirmed exactly which files go into the first commit. */
  private async initForImport(real: string, confirmed: string[], identity: Record<string, string>) {
    const { git } = this.opts;
    // Rolling back removes .git, so it must be ours: refuse if one appeared since the inspection, including
    // a symbolic link (existsSync would follow a dangling link and let git init write into its target).
    if (fs.lstatSync(path.join(real, ".git"), { throwIfNoEntry: false }))
      throw new SiteError("site.file_list_changed", 409);
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
      fs.mkdirSync(path.join(scratch, "info"), { recursive: true });
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

  private async register(
    real: string,
    name: string,
    defaultBranch: string,
    checked?: Prechecked,
    notionDataSourceId: string | null = null,
  ): Promise<Site> {
    if (!(await isValidBranchName(this.opts.git, defaultBranch, real))) throw new SiteError("site.bad_branch", 400);
    const id = newSiteId();
    try {
      this.store.insert({ id, name, path: real, defaultBranch, notionDataSourceId });
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
  /**
   * Bind (or with null, unbind) the saved Notion data source whose token main builds use, then check the
   * site again, since its config check depends on the binding. Both happen under the site lock, so a busy
   * site keeps its old binding.
   */
  bindNotionSource(id: string, sourceId: string | null): Promise<Site> {
    return this.check(id, undefined, () => this.store.setNotionDataSourceId(id, sourceId));
  }

  private async check(id: string, checked?: Prechecked, before?: () => void): Promise<Site> {
    const site = this.get(id);
    await this.opts.locks.run(id, "recheck", async () => {
      before?.();
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
    // The default branch is reviewed content, so a Notion site is checked with its bound token; without one
    // Bukit refuses the config, so the state says a data source must be bound.
    let configCheck: ConfigCheck;
    if (guard.usesNotion) {
      let token: string | null;
      try {
        token = this.notionToken(id);
      } catch {
        // An unreadable token file fails the check, not the site: builds say why when they run.
        token = "";
      }
      configCheck = token === null ? "notion" : token === "" ? "failed" : await this.configCheck(checkout, token);
    } else configCheck = await this.configCheck(checkout);
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
   * using it. With `reset`, it is checked out at `commit` and cleaned (a new change set, plan 7.2);
   * without, an existing copy is left as it is and only a missing or broken one is made at `commit`.
   * Read-only sites get none. The caller holds the site lock (it runs git in the site repository).
   */
  async aiWorktree(id: string, commit: string, opts: { reset: boolean }): Promise<string> {
    const site = this.get(id);
    if (site.readOnly) throw new SiteError("site.read_only", 409);
    const dir = path.join(this.opts.paths.worktrees, id, "ai");
    if (!opts.reset && fs.existsSync(dir) && (await this.isCheckoutOf(dir, site.path))) return dir;
    return this.checkout(id, site.path, "ai", commit);
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

  // --- Bukit 2.1 language migration (plan 8.7) ---

  /** Whether the default branch's site.yaml needs the language migration, with the patch it would commit. */
  async languageMigration(id: string): Promise<LanguageMigrationResponse> {
    const site = this.get(id);
    const head = await this.headOf(site);
    const none: LanguageMigrationResponse = {
      commit: head,
      state: "none",
      reason: null,
      patch: null,
      movesToRoot: false,
    };
    if (site.readOnly) return none;
    const text = await readBlobAt(this.opts.git, site.path, head, "site.yaml", MAX_SITE_YAML);
    if (text === null) return none;
    const plan = planLanguageMigration(text.toString("utf8"));
    if (!plan.needed) return none;
    if (!plan.ok) return { ...none, state: "blocked", reason: plan.reason };
    const patch = await siteYamlPatch(this.opts.git, site.path, head, plan.text);
    return { commit: head, state: "ready", reason: null, patch, movesToRoot: plan.movesToRoot };
  }

  /** Commit the migration on top of `commit`, the head the user saw the patch for, like deploy settings do. */
  async applyLanguageMigration(id: string, commit: string): Promise<LanguageMigrationResponse> {
    return this.opts.locks.run(id, "language-migration", async () => {
      const site = this.get(id);
      if (site.readOnly) throw new SiteError("site.read_only", 409);
      const head = await this.headOf(site);
      if (head !== commit) throw new SiteError("language.commit_changed", 409);
      await commitSiteYaml({
        git: this.opts.git,
        sites: this,
        site,
        head,
        message: "Migrate language settings for Bukit 2.1",
        codes: LANGUAGE_CODES,
        edit: (text) => {
          const plan = planLanguageMigration(text);
          if (!plan.needed || !plan.ok) throw new SiteError("language.not_needed", 409);
          return plan.text;
        },
      });
      return this.languageMigration(id);
    });
  }

  /** worktrees/<siteId>/<name> at `commit`, detached: made when missing or broken, otherwise reset. */
  private async checkout(id: string, sitePath: string, name: "ai" | "main", commit: string): Promise<string> {
    const { git } = this.opts;
    const dir = path.join(this.opts.paths.worktrees, id, name);
    // A checkout left half-made, or whose registration is gone (the site repository was re-cloned), is
    // made again instead of failing every check from now on.
    if (fs.existsSync(dir) && !(await this.isCheckoutOf(dir, sitePath)))
      fs.rmSync(dir, { recursive: true, force: true });
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
        await git.run(["worktree", "prune"], { cwd: sitePath });
        await git.run(["worktree", "add", "-q", "--detach", dir, commit], { cwd: sitePath });
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
        fs.realpathSync.native(top) === fs.realpathSync.native(dir) &&
        fs.realpathSync.native(common) === fs.realpathSync.native(await this.commonDir(sitePath))
      );
    } catch {
      return false;
    }
  }

  private async configCheck(checkout: string, notionToken?: string): Promise<ConfigCheck> {
    const runner = await usableRunner(this.opts.bukit, {
      git: this.opts.git,
      home: this.opts.paths.home,
      tmpDir: this.opts.paths.bukitTmp,
    });
    if (!runner) return "not_run";
    const env = notionToken === undefined ? {} : { env: { NOTION_TOKEN: notionToken } };
    return checkPassed(await runner.run("check", ["config", "check"], { cwd: checkout, ...env })) ? "ok" : "failed";
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
    // Stop the site's AI runs first: a check or build they started holds the site lock until it ends, and
    // stopping makes it end. Again inside the lock, for a run that started in between.
    for (const hook of this.removingHooks) await hook(id);
    return this.opts.locks.run(id, "remove", async () => {
      const { git } = this.opts;
      const leftovers: string[] = [];
      for (const hook of this.removingHooks) await hook(id);
      fs.rmSync(path.join(this.opts.paths.worktrees, id), { recursive: true, force: true });
      // A folder that is no longer a git repository (or fails the check) only leaves leftovers: removal must
      // always succeed, since that is what the user does about such a site.
      const repoOk = fs.existsSync(site.path) && (await this.repoReasons(site.path).catch(() => null))?.length === 0;
      if (repoOk) {
        // Another registered site can share this repository (a linked worktree): its change refs stay.
        const owner = this.opts.db.prepare("SELECT site_id FROM change_sets WHERE id = ?");
        const refs = splitLines(
          await git.text(["for-each-ref", "--format=%(refname)", "refs/bukitjalil/"], { cwd: site.path }),
        ).filter((ref) => {
          const row = owner.get(ref.slice(ref.lastIndexOf("/") + 1)) as { site_id: string } | undefined;
          return !row || row.site_id === id;
        });
        for (const ref of refs) await git.run(["update-ref", "-d", ref], { cwd: site.path });
        await git.run(["worktree", "prune"], { cwd: site.path });
      } else {
        leftovers.push("worktree_registrations", "refs");
      }
      // A .git link may point at another repository; never write its exclude block through it.
      const common =
        !gitSymlink(site.path) && fs.existsSync(site.path) ? await this.commonDir(site.path).catch(() => null) : null;
      // The block is shared too: it stays while another registered site uses the same repository.
      const shared =
        common !== null &&
        (
          await Promise.all(
            this.store
              .list()
              .filter((other) => other.id !== id && fs.existsSync(other.path))
              .map((other) => this.commonDir(other.path).catch(() => null)),
          )
        ).includes(common);
      if (common && !shared) removeExcludeBlock(common);
      else if (!common) leftovers.push("exclude_block");
      fs.rmSync(path.join(this.opts.paths.sessions, id), { recursive: true, force: true });
      fs.rmSync(path.join(this.opts.paths.previews, id), { recursive: true, force: true });
      this.store.delete(id);
      return { leftovers };
    });
  }

  // --- git helpers ---

  /** Repository config allowlist result (plan 7.3) as site reasons; [] when the repository is acceptable. */
  private async repoReasons(cwd: string): Promise<SiteReason[]> {
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
  private async toplevel(dir: string): Promise<string | null> {
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

/** A .git link can point the repository at another folder; never read or write through it. */
const gitSymlink = (dir: string): boolean =>
  fs.lstatSync(path.join(dir, ".git"), { throwIfNoEntry: false })?.isSymbolicLink() === true;

function assertNoGitSymlink(real: string): void {
  if (gitSymlink(real)) throw new SiteError("site.git_symlink", 400);
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

// Built-in site.data keys, so a database titled like one of them gets a safe name.
const RESERVED_SOURCE_NAMES = new Set(["taxonomy", "pages_by_id", "taxonomy_ensure_terms", "menus"]);

/**
 * A unique source name from a Notion database title: its ASCII slug, or notion, notion_2, ... Names match
 * Bukit's rule for sources with a dataIndex (^[a-z][a-z0-9_]*$) and work as site.data keys in templates.
 */
function uniqueSourceName(title: string, used: Set<string>): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[_0-9]+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/, "");
  const base = slug || "notion";
  let name = RESERVED_SOURCE_NAMES.has(base) ? `${base}_source` : base;
  for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
  used.add(name);
  return name;
}

const splitZ = (out: string) => out.split("\0").filter((s) => s.length > 0);
const splitLines = (out: string) => out.split("\n").filter((s) => s.length > 0);
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}
