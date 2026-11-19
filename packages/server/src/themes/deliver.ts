import fs from "node:fs";
import path from "node:path";
import {
  type Site,
  type ThemeApplyPlan,
  type ThemeApplyRequest,
  type ThemeApplyResult,
  ThemeName,
} from "@bukitjalil/shared";
import { zipSync } from "fflate";
import { parseDocument } from "yaml";
import type { ChangeService } from "../changes/service.ts";
import { listTree, readBlobAt, readBlobs, SYMLINK_MODE, type TreeEntry } from "../git/objects.ts";
import { GitError, type GitRunner } from "../git/run.ts";
import type { Logger } from "../log.ts";
import type { AppPaths } from "../paths.ts";
import type { Project, ProjectService } from "../projects/service.ts";
import { SiteError } from "../sites/location.ts";
import type { SiteLocks } from "../sites/locks.ts";
import { themeKey } from "./service.ts";

/**
 * Media uploads live in the theme's static folder (media/dir.ts): applying a theme keeps the site's uploads
 * instead of replacing or orphaning them.
 */
const UPLOADS = "static/uploads";
const isUpload = (rel: string) => rel === UPLOADS || rel.startsWith(`${UPLOADS}/`);

/** A theme is a deliverable, not a site: a large one is refused rather than held in memory (design 5, 7). */
const MAX_THEME_BYTES = 50 * 1024 * 1024;
const MAX_CONFIG_BYTES = 1024 * 1024;

export interface ThemeDeliverOptions {
  git: GitRunner;
  paths: AppPaths;
  projects: ProjectService;
  changes: ChangeService;
  locks: SiteLocks;
  logger: Logger;
}

/**
 * Delivering a theme project (theme development design 7): apply its default branch to a site as a
 * user-authored change set, or export `themes/<name>/` as a zip. Nothing here writes a site's default
 * branch; applying is reviewed on the site like every other change.
 */
export class ThemeDeliverService {
  constructor(private readonly opts: ThemeDeliverOptions) {}

  /** What applying the theme to `siteId` would change, for the confirmation dialog (design 7). */
  async plan(themeId: string, siteId: string): Promise<ThemeApplyPlan> {
    const theme = this.theme(themeId);
    const site = this.site(siteId);
    const source = await this.source(theme, await this.opts.projects.headOf(theme));
    const targetHead = await this.opts.projects.headOf(site);
    const target = await entries(this.opts.git, site.path, targetHead, theme.themeName);
    const added: string[] = [];
    const modified: string[] = [];
    for (const [rel, entry] of source) {
      const old = target.get(rel);
      if (!old) added.push(rel);
      // The site's own upload of the same name is kept (see apply), so it does not change.
      else if ((old.oid !== entry.oid || old.mode !== entry.mode) && !isUpload(rel)) modified.push(rel);
    }
    // The site's uploads are kept (see apply), so they are not removed.
    const removed = [...target.keys()].filter((rel) => !source.has(rel) && !isUpload(rel));
    return {
      site: { id: site.id, name: site.name },
      theme: { name: theme.themeName, dir: `themes/${theme.themeName}` },
      existing: target.size > 0,
      added: added.sort(),
      modified: modified.sort(),
      removed: removed.sort(),
      configTheme: await this.configTheme(site.path, targetHead, site.configFile),
    };
  }

  /**
   * Copy the theme project's default branch into the site's AI checkout and snapshot it as the user's change
   * set (design 7). The whole `themes/<name>/` directory is replaced, so the plan's `removed` files go too;
   * `overwrite` is required when the site already has that theme. The directory swap is rolled back if a
   * later step fails, and a change set this request created is closed rather than left empty.
   */
  async apply(themeId: string, req: ThemeApplyRequest, busy: () => boolean): Promise<ThemeApplyResult> {
    return this.opts.locks.run(req.siteId, "theme", async () => {
      const theme = this.theme(themeId);
      const site = this.site(req.siteId);
      // A running conversation writes the same checkout; checked under the lock, where a run cannot start.
      if (busy()) throw new SiteError("site.busy", 409, { operation: "session" });
      // A change set the AI is still filling must be dealt with first (like a restore): replacing a whole
      // theme under it would hide what the user is reviewing.
      const open = await this.opts.changes.current(req.siteId, false);
      if (open?.reviewable) throw new SiteError("change.open_exists", 409);
      const source = await this.source(theme, await this.opts.projects.headOf(theme));
      const target = await entries(this.opts.git, site.path, await this.opts.projects.headOf(site), theme.themeName);
      if (target.size > 0 && !req.overwrite) throw new SiteError("theme.exists", 409, { theme: theme.themeName });
      const files = await contents(this.opts.git, theme.path, source);

      const { cwd, change, created } = await this.opts.changes.beginUserChange(req.siteId);
      const dir = path.join(cwd, "themes", theme.themeName);
      const tmp = path.join(this.opts.paths.worktrees, req.siteId, `.theme-apply-${process.pid}`);
      const staged = path.join(tmp, "new");
      let installed = false;
      let snapshotted = false;
      let backup: string | null = null;
      let configBackup: { file: string; raw: string } | null = null;
      try {
        // Ignored paths are deleted by the snapshot, not committed; refusing here keeps the copy visible.
        if (await this.ignored(cwd, `themes/${theme.themeName}`))
          throw new SiteError("theme.ignored", 409, { path: `themes/${theme.themeName}` });
        if (req.setConfig && (await this.ignored(cwd, site.configFile)))
          throw new SiteError("theme.ignored", 409, { path: site.configFile });
        // A previous run of this process that failed mid-way may have left its staging area.
        fs.rmSync(tmp, { recursive: true, force: true });
        stage(staged, source, files);
        this.ensureThemesDir(cwd);
        this.assertTarget(dir);
        // Keep the site's uploads: those of this theme's old copy, and, when the site switches to this theme,
        // those of the theme it used before. They are the user's files, so they win over the theme's own.
        copyUploads(dir, staged);
        const previous = req.setConfig ? uploadsTheme(cwd, site.configFile) : null;
        if (previous !== null && previous !== theme.themeName) {
          const old = path.join(cwd, "themes", previous);
          this.assertTarget(old);
          copyUploads(old, staged);
        }
        if (fs.existsSync(dir)) {
          backup = path.join(tmp, "old");
          fs.renameSync(dir, backup);
        }
        fs.renameSync(staged, dir);
        installed = true;
        if (req.setConfig) configBackup = setTheme(cwd, site.configFile, theme.themeName);
        await this.opts.changes.snapshot(req.siteId, cwd, { byUser: true });
        snapshotted = true;
        // The snapshot is the point of no return: after it, the change set must match the files. A failure
        // to read it back or to write the label is only logged; the copied theme stays.
        let view: Awaited<ReturnType<ChangeService["current"]>> = null;
        try {
          view = await this.opts.changes.current(req.siteId, false);
        } catch (err) {
          this.opts.logger.log("warn", "theme.current_failed", { siteId: req.siteId, error: String(err) });
        }
        if (view && !view.reviewable) {
          // Applying the same theme again: do not leave an empty change set behind, but only close one this
          // request opened.
          if (created) await this.opts.changes.discard(change.id);
          return { siteId: req.siteId, changeId: null };
        }
        if (!change.aiJoined && change.restoreCommit === null) {
          const line = `Applied theme ${theme.themeName} from ${theme.name}${req.setConfig ? " and set the site's theme" : ""}`;
          const summary = change.userSummary?.trim() ? `${change.userSummary.trim()}\n\n${line}` : line;
          try {
            this.opts.changes.store.setUserSummary(change.id, summary);
          } catch (err) {
            this.opts.logger.log("warn", "theme.summary_failed", {
              siteId: req.siteId,
              changeId: change.id,
              error: String(err),
            });
          }
        }
        try {
          this.opts.changes.notify(req.siteId);
        } catch (err) {
          this.opts.logger.log("warn", "theme.notify_failed", { siteId: req.siteId, error: String(err) });
        }
        return { siteId: req.siteId, changeId: change.id };
      } catch (err) {
        if (!snapshotted) {
          if (installed) fs.rmSync(dir, { recursive: true, force: true });
          if (backup) {
            try {
              fs.renameSync(backup, dir);
            } catch (restoreErr) {
              this.opts.logger.log("warn", "theme.rollback_failed", { siteId: req.siteId, error: String(restoreErr) });
            }
          }
          if (configBackup) fs.writeFileSync(configBackup.file, configBackup.raw);
          if (created && this.opts.changes.store.open(req.siteId)?.id === change.id)
            await this.opts.changes.discard(change.id);
        }
        throw err;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  /** `themes/<name>/` of the default branch as a zip; sample content and reference material stay out (design 7). */
  async exportZip(themeId: string): Promise<{ name: string; data: Buffer }> {
    const theme = this.theme(themeId);
    const source = await this.source(theme, await this.opts.projects.headOf(theme));
    const files = await contents(this.opts.git, theme.path, source);
    const entries: Record<string, Uint8Array> = {};
    for (const [rel, data] of files) entries[rel] = new Uint8Array(data);
    return { name: `${theme.themeName}.zip`, data: Buffer.from(zipSync(entries, { level: 6 })) };
  }

  /** The theme project as a deliverable, refusing one that fails the safety checks (its files are not trusted). */
  private theme(themeId: string): Project & { themeName: string } {
    const theme = this.opts.projects.get(themeKey(themeId));
    if (theme.readOnly) throw new SiteError("site.read_only", 409);
    if (theme.themeName === null) throw new SiteError("theme.not_found", 404);
    return { ...theme, themeName: theme.themeName };
  }

  private site(siteId: string): Site {
    const site = this.opts.projects.site(siteId);
    if (site.readOnly) throw new SiteError("site.read_only", 409);
    return site;
  }

  /** The theme's files, refusing an empty or too large deliverable. */
  private async source(theme: Project & { themeName: string }, commit: string): Promise<Map<string, TreeEntry>> {
    const source = await entries(this.opts.git, theme.path, commit, theme.themeName);
    if (source.size === 0) throw new SiteError("theme.empty", 409, { theme: theme.themeName });
    let total = 0;
    for (const entry of source.values()) {
      total += entry.size ?? 0;
      if (total > MAX_THEME_BYTES) throw new SiteError("theme.too_large", 409, { max: String(MAX_THEME_BYTES) });
    }
    return source;
  }

  /** The `theme.name` in the site's config at `commit`, or null when it has none. */
  private async configTheme(repo: string, commit: string, configFile: string): Promise<string | null> {
    try {
      const raw = await readBlobAt(this.opts.git, repo, commit, configFile, MAX_CONFIG_BYTES);
      const doc = raw ? parseDocument(raw.toString("utf8")) : null;
      const value = doc && doc.errors.length === 0 ? doc.getIn(["theme", "name"]) : null;
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }

  /** A path the site's .gitignore would keep out of the snapshot. */
  private async ignored(cwd: string, rel: string): Promise<boolean> {
    const result = await this.opts.git.run(["check-ignore", "-q", "--", rel], { cwd, okCodes: [0, 1] });
    return result.code === 0;
  }

  /** `themes/` in the checkout must be a real directory, not a link. */
  private ensureThemesDir(cwd: string): void {
    const parent = path.join(cwd, "themes");
    const stat = fs.lstatSync(parent, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new SiteError("theme.target_unsafe", 409);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  }

  private assertTarget(dir: string): void {
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new SiteError("theme.target_unsafe", 409);
  }
}

/** Blobs under `themes/<name>/` at `commit`, by path relative to that directory; symlinks and submodules skipped. */
async function entries(git: GitRunner, repo: string, commit: string, name: string): Promise<Map<string, TreeEntry>> {
  const dir = `themes/${name}`;
  let list: TreeEntry[];
  try {
    list = await listTree(git, repo, commit, { recursive: true, dir });
  } catch (err) {
    // The commit has no such directory (git ls-tree reports it like a failed revision).
    if (err instanceof GitError && err.kind === "failed") return new Map();
    throw err;
  }
  const out = new Map<string, TreeEntry>();
  for (const entry of list) {
    if (entry.type !== "blob" || entry.mode === SYMLINK_MODE) continue;
    out.set(entry.path.slice(dir.length + 1), entry);
  }
  return out;
}

/** The contents of `entries` with one `git cat-file --batch`. */
async function contents(git: GitRunner, repo: string, entries: Map<string, TreeEntry>): Promise<Map<string, Buffer>> {
  const blobs = await readBlobs(
    git,
    repo,
    [...entries.values()].map((e) => e.oid),
    MAX_THEME_BYTES,
  );
  const out = new Map<string, Buffer>();
  for (const [rel, entry] of entries) {
    const data = blobs.get(entry.oid);
    if (!data) throw new SiteError("theme.empty", 409);
    out.set(rel, data);
  }
  return out;
}

/** Write the theme into a fresh directory outside the checkout, then swap it in as a whole. */
function stage(dir: string, entries: Map<string, TreeEntry>, files: Map<string, Buffer>): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [rel, entry] of entries) {
    // The files came from git; a path is still checked before it becomes a file system path.
    const steps = rel.split("/");
    if (steps.some((s) => s === "" || s === "." || s === ".." || s.includes("\\")))
      throw new SiteError("theme.empty", 409);
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, files.get(rel) ?? Buffer.alloc(0));
    fs.chmodSync(file, entry.mode === "100755" ? 0o755 : 0o644);
  }
}

/**
 * Copy the regular files under `<from>/static/uploads` into `<to>/static/uploads`, replacing what `to` has
 * there (`to` is the fresh staging copy); a symbolic link anywhere is refused, as in the media upload.
 */
function copyUploads(from: string, to: string): void {
  const walk = (rel: string) => {
    const src = path.join(from, ...rel.split("/"));
    const stat = fs.lstatSync(src, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new SiteError("media.dir_unsafe", 409);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(src)) walk(`${rel}/${name}`);
      return;
    }
    if (!stat.isFile()) return;
    const dest = path.join(to, ...rel.split("/"));
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
  };
  for (const part of ["static", UPLOADS]) {
    const stat = fs.lstatSync(path.join(from, ...part.split("/")), { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new SiteError("media.dir_unsafe", 409);
  }
  walk(UPLOADS);
}

/**
 * The theme whose static folder holds the site's uploads now, or null when the config names none or puts
 * the static folder elsewhere (then switching themes leaves the uploads where they are).
 */
function uploadsTheme(cwd: string, configFile: string): string | null {
  try {
    const file = path.join(cwd, configFile);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) return null;
    const doc = parseDocument(fs.readFileSync(file, "utf8"));
    if (doc.errors.length > 0) return null;
    const name = doc.getIn(["theme", "name"]);
    const staticDir = doc.getIn(["theme", "static"]);
    if (staticDir !== undefined && staticDir !== null && String(staticDir).toLowerCase() !== "static") return null;
    return typeof name === "string" && ThemeName.safeParse(name).success ? name : null;
  } catch {
    return null;
  }
}

/** Point the site's `theme.name` at `name`; returns the old text so a failed apply can put it back. */
function setTheme(cwd: string, configFile: string, name: string): { file: string; raw: string } | null {
  const file = path.join(cwd, configFile);
  let raw: string;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIG_BYTES)
      throw new SiteError("config.invalid_yaml", 409);
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err instanceof SiteError) throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new SiteError("site.no_site_yaml", 409);
    throw new SiteError("config.invalid_yaml", 409);
  }
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) throw new SiteError("config.invalid_yaml", 409);
  if (doc.getIn(["theme", "name"]) === name) return null;
  try {
    doc.setIn(["theme", "name"], name);
  } catch {
    throw new SiteError("config.invalid_yaml", 409);
  }
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }));
  return { file, raw };
}
