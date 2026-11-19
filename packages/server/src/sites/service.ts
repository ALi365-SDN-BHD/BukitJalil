import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  type CreateSiteRequest,
  DEFAULT_CONFIG_FILE,
  type ImportInspection,
  type ImportSiteRequest,
  type Site,
  SiteName,
  type SitePatch,
} from "@bukitjalil/shared";
import { parseDocument } from "yaml";
import { type GuardResult, guardCommit } from "../bukit/guard.ts";
import type { BukitService } from "../bukit/locate.ts";
import type { DataSourceService } from "../data-sources/service.ts";
import { resolveBranch } from "../git/objects.ts";
import type { GitRunner } from "../git/run.ts";
import type { AppPaths } from "../paths.ts";
import { gitSymlink, type Prechecked, ProjectRepos, type ProjectState } from "../projects/repo.ts";
import type { SettingsStore } from "../store/settings.ts";
import { findConfigCandidates } from "./config-candidates.ts";
import { EXCLUDE_PATTERNS, IMPORT_INIT_PATTERNS, writeExcludeBlock } from "./exclude.ts";
import { assertDirectory, assertEmptyOrMissing, checkSiteLocation, SiteError } from "./location.ts";
import type { SiteLocks } from "./locks.ts";
import { NotionSnapshots } from "./notion-snapshots.ts";
import { isSiteId, newSiteId, SiteStore } from "./store.ts";
import { type NewSite, type StarterSource, writeSources } from "./template.ts";

export interface SiteServiceOptions {
  db: DatabaseSync;
  git: GitRunner;
  paths: AppPaths;
  settings: SettingsStore;
  bukit: BukitService;
  locks: SiteLocks;
  /** Optional saved Notion source copied into a new site. */
  dataSources: DataSourceService;
  /** Writes a new site's starting files: `bukit new` (plan 5.2), a stand-in in tests. */
  newSite: NewSite;
  /** Overrides os.homedir() (tests). */
  userHome?: string;
  /** The sites' Notion offline snapshots (plan 5.5); made from `paths` when not given. */
  notionSnapshots?: NotionSnapshots;
  /** Repository work shared with theme projects; made from the options above when not given. */
  repos?: ProjectRepos;
  /** Directories of the registered theme projects: a site may not overlap them (theme design 3.1). */
  otherProjects?: () => { name: string; path: string }[];
}

const INITIAL_MESSAGE = "Initial site from BukitJalil starter";
const IMPORT_MESSAGE = "Initial commit from BukitJalil import";
const MAX_IMPORT_FILES = 100_000;

/**
 * Sites (plan 5.1, 5.2): create from the starter, import an existing directory, safety state, removal.
 * A site that fails the repository or pre-build checks is kept but read-only: no checkout is created and
 * Bukit is never run for it.
 */
export class SiteService {
  readonly store: SiteStore;
  readonly repos: ProjectRepos;
  private readonly addedHooks: ((site: Site) => Promise<void>)[] = [];
  private readonly removingHooks: ((siteId: string) => Promise<void>)[] = [];

  /** Notion offline snapshots (plan 5.5): builds record them, offline checks and builds read them. */
  readonly notionSnapshots: NotionSnapshots;

  constructor(private readonly opts: SiteServiceOptions) {
    this.store = new SiteStore(opts.db);
    this.repos = opts.repos ?? new ProjectRepos(opts);
    this.notionSnapshots =
      opts.notionSnapshots ?? new NotionSnapshots({ db: opts.db, root: opts.paths.notionSnapshots });
    opts.dataSources.onTokenReplaced?.((sourceId) => {
      for (const site of this.store.list()) {
        if (this.store.notionDataSourceId(site.id) === sourceId) void this.dropNotionSnapshot(site.id);
      }
    });
  }

  /** Delete a site's Notion offline snapshot once nothing is building with it (the site lock is free). */
  private async dropNotionSnapshot(id: string): Promise<void> {
    for (;;) {
      await this.opts.locks.waitFree(id);
      try {
        await this.opts.locks.run(id, "notion-snapshot", async () =>
          this.notionSnapshots.tryRemove(id, "token_replaced"),
        );
        return;
      } catch (err) {
        if (!(err instanceof SiteError && err.code === "site.busy")) return;
      }
    }
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
    return {
      appHome: this.opts.paths.home,
      userHome: this.opts.userHome,
      sites: this.store.list(),
      themes: this.opts.otherProjects?.() ?? [],
    };
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

  // --- create (plan 5.2) ---

  async create(req: CreateSiteRequest): Promise<Site> {
    const identity = this.commitIdentity();
    const real = checkSiteLocation(req.path, this.rules());
    const selected = this.selectedSources(req);
    const site = await this.repos.reserved(real, async () => {
      assertEmptyOrMissing(real);
      const existed = fs.existsSync(real);
      try {
        await this.opts.newSite(real, { title: req.name, language: req.language });
        if (selected) writeSources(real, selected.sources);
        const { git } = this.opts;
        // -b main: global config (init.defaultBranch) is not read, so git would pick "master".
        await git.run(["init", "-q", "-b", "main"], { cwd: real, repoCheck: false });
        writeExcludeBlock(await this.repos.commonDir(real));
        await git.run(["add", "-A"], { cwd: real });
        await git.run(["commit", "-q", "--no-verify", "-m", INITIAL_MESSAGE], { cwd: real, config: identity });
      } catch (err) {
        removeCreated(real, existed);
        throw err;
      }
      return this.register(
        real,
        req.name,
        "main",
        DEFAULT_CONFIG_FILE,
        undefined,
        selected?.notionDataSourceId ?? null,
      );
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
  async inspectImport(target: string, configFile?: string): Promise<ImportInspection> {
    return (await this.inspect(target, configFile)).inspection;
  }

  /**
   * The config is whichever root YAML file has the content of a site config (config-candidates.ts); its
   * name is never looked at. With several, the user's choice (`configFile`) is accepted only if its
   * content still qualifies.
   */
  private async inspect(
    target: string,
    configFile?: string,
  ): Promise<{ inspection: ImportInspection; checked?: Prechecked }> {
    const real = checkSiteLocation(target, this.rules());
    assertDirectory(real);
    assertNoGitSymlink(real);
    const candidates = findConfigCandidates(real);
    if (candidates.length === 0) throw new SiteError("site.no_site_yaml", 400);
    let config: string;
    if (configFile !== undefined) {
      if (!candidates.includes(configFile)) throw new SiteError("site.bad_config_file", 400);
      config = configFile;
    } else if (candidates.length === 1) {
      config = candidates[0] as string;
    } else {
      return { inspection: { kind: "pick_config", path: real, candidates } };
    }

    const top = await this.repos.toplevel(real);
    if (top === null) {
      return { inspection: { kind: "not_git", path: real, configFile: config, files: await this.filesForInit(real) } };
    }
    // git does not say where a repository it refuses starts, so require .git right here.
    const isRoot = top === "dubious" ? fs.existsSync(path.join(real, ".git")) : fs.realpathSync.native(top) === real;
    if (!isRoot) throw new SiteError("site.not_repo_root", 400);

    const branch = await this.repos.currentBranch(real);
    const repoReasons = await this.repos.repoReasons(real);
    if (repoReasons.length > 0) {
      return { inspection: { kind: "git", path: real, branch, configFile: config, readOnly: repoReasons } };
    }

    let commit: string;
    try {
      commit = await resolveBranch(this.opts.git, real, branch);
    } catch {
      throw new SiteError("site.no_commits", 400);
    }
    const status = await this.opts.git.text(["status", "--porcelain=v1", "-z", "--untracked-files=no"], { cwd: real });
    if (status.length > 0) throw new SiteError("site.dirty", 409);
    const guard = await guardCommit(this.opts.git, real, commit, config);
    return {
      inspection: { kind: "git", path: real, branch, configFile: config, readOnly: guard.ok ? null : guard.reasons },
      checked: { commit, guard },
    };
  }

  async import(req: ImportSiteRequest): Promise<Site> {
    const real = checkSiteLocation(req.path, this.rules());
    const site = await this.repos.reserved(real, async () => {
      const { inspection, checked } = await this.inspect(real, req.configFile);
      if (inspection.kind === "pick_config") throw new SiteError("site.bad_config_file", 400);
      const name = req.name ?? siteTitle(real, inspection.configFile) ?? path.basename(real);
      if (inspection.kind === "git") {
        return this.register(real, name, inspection.branch, inspection.configFile, checked);
      }
      if (!req.initGit) throw new SiteError("site.not_git", 409);
      await this.initForImport(real, req.initGit.files, this.commitIdentity());
      return this.register(real, name, "main", inspection.configFile);
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
      writeExcludeBlock(await this.repos.commonDir(real), [...EXCLUDE_PATTERNS, ...IMPORT_INIT_PATTERNS]);
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
    configFile: string,
    checked?: Prechecked,
    notionDataSourceId: string | null = null,
  ): Promise<Site> {
    await this.repos.assertBranch(defaultBranch, real);
    const id = newSiteId();
    try {
      this.store.insert({ id, name, path: real, defaultBranch, notionDataSourceId, configFile });
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
    return this.check(id, undefined, () => {
      // The snapshot holds what the old source's token could read; another source (or none) drops it.
      if (this.store.notionDataSourceId(id) !== sourceId) this.notionSnapshots.remove(id);
      this.store.setNotionDataSourceId(id, sourceId);
    });
  }

  private async check(id: string, checked?: Prechecked, before?: () => void): Promise<Site> {
    const site = this.get(id);
    await this.opts.locks.run(id, "recheck", async () => {
      before?.();
      let state: ProjectState;
      try {
        state = await this.repos.evaluate(id, site, checked, () => this.notionToken(id));
      } catch (err) {
        const detail = err instanceof Error ? err.message.slice(0, 500) : String(err);
        state = { readOnly: [{ code: "not_checked", detail }], checkedCommit: null, configCheck: null };
      }
      this.store.setState(id, state);
    });
    return this.get(id);
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
   * sessions, previews and Notion snapshot. The site directory itself is never deleted. Steps that need
   * git are skipped for a repository that fails the config check; they are returned as `leftovers`.
   */
  async remove(id: string): Promise<{ leftovers: string[] }> {
    const site = this.get(id);
    // Stop the site's AI runs first: a check or build they started holds the site lock until it ends, and
    // stopping makes it end. Again inside the lock, for a run that started in between.
    for (const hook of this.removingHooks) await hook(id);
    return this.opts.locks.run(id, "remove", async () => {
      for (const hook of this.removingHooks) await hook(id);
      const others = [
        ...this.store.list().filter((other) => other.id !== id),
        ...(this.opts.otherProjects?.() ?? []),
      ].map((p) => p.path);
      const leftovers = await this.repos.removeFiles(id, site, others);
      this.notionSnapshots.remove(id);
      this.store.delete(id);
      return { leftovers };
    });
  }
}

/** site.title from site.yaml, as the default display name of an imported site. */
function siteTitle(dir: string, configFile: string): string | null {
  try {
    const doc = parseDocument(fs.readFileSync(path.join(dir, configFile), "utf8"), { schema: "failsafe" });
    const title = doc.getIn(["site", "title"]);
    // The same rules as a name typed in the UI: no control or bidi characters.
    const parsed = typeof title === "string" ? SiteName.safeParse(title) : null;
    return parsed?.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function assertNoGitSymlink(real: string): void {
  if (gitSymlink(real)) throw new SiteError("site.git_symlink", 400);
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
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}
