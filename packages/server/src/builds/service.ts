import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  Build,
  BuildAudit,
  BuildOutcome,
  BuildReport,
  BuildStatus,
  PanelRef,
  PreviewResponse,
  Site,
} from "@bukitjalil/shared";
import { guardCommit, isRecord } from "../bukit/guard.ts";
import type { BukitService } from "../bukit/locate.ts";
import { type BukitRunner, type BukitRunResult, buildOutcome, logEntry, usableRunner } from "../bukit/runner.ts";
import type { ChangeService } from "../changes/service.ts";
import { readBlobAt } from "../git/objects.ts";
import type { GitRunner } from "../git/run.ts";
import type { Logger } from "../log.ts";
import { parseYaml } from "../panels/yaml.ts";
import type { AppPaths } from "../paths.ts";
import { NoPreviewPortError, PreviewPool } from "../preview/pool.ts";
import type { SecretStore } from "../settings/secrets.ts";
import { SiteError } from "../sites/location.ts";
import type { SiteLocks } from "../sites/locks.ts";
import type { SiteService } from "../sites/service.ts";
import { storageErrorCode, storageErrorInText } from "../storage-errors.ts";
import { readAudit } from "./audit.ts";
import { type BuildRecord, BuildStore, newBuildId } from "./store.ts";

export interface BuildServiceOptions {
  db: DatabaseSync;
  git: GitRunner;
  paths: AppPaths;
  sites: SiteService;
  bukit: BukitService;
  locks: SiteLocks;
  previews: PreviewPool;
  changes: ChangeService;
  secrets: SecretStore;
  logger: Logger;
}

/** Kept build outputs per site, besides the ones a preview shows (plan 8.4). */
export const KEEP_OUTPUTS = 10;
const KEEP_RECORDS = 50;
const LIST_LIMIT = 50;
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 2000;
const MAX_OUTPUT_CHARS = 8000;
/** Bukit builds into a fresh directory under this one in the checkout (plan 8.4); it is a BUILD_DIR. */
export const BUILD_OUTPUT_PARENT = ".bukitjalil-build";

/** `bukit build` into BUILD_OUTPUT_PARENT/<name> for a preview served at "/" (plan 8.3). */
export const buildArgs = (name: string) => [
  "build",
  "--config",
  "site.yaml",
  "--output",
  `${BUILD_OUTPUT_PARENT}/${name}`,
  "--base-url",
  "/",
  "--no-clean",
  "--log-format",
  "json",
];

/** A build started or ended; `build` is the record as the API shows it (with its report at the end). */
export interface BuildEvent {
  type: "build.start" | "build.end";
  build: Build;
}

/**
 * Builds and previews (plan 8.3, 8.4). A main build runs in worktrees/<siteId>/main at the default
 * branch head, never in the site directory: the commit passes the pre-build guard, Bukit writes into a
 * fresh .bukitjalil-build/<buildId>/ with --no-clean, and a successful output without symlinks moves to
 * previews/<siteId>/<buildId>/. The site lock is held for the whole build.
 *
 * A change build previews the site's open change set (plan 8.4): it runs in worktrees/<siteId>/ai at a
 * fresh snapshot, always passes the guard first and never gets secrets (plan 8.5). Its preview only ever
 * shows builds of the open change set; once that closes, its preview port is let go.
 */
export class BuildService {
  readonly store: BuildStore;
  private readonly running = new Map<string, { promise: Promise<void>; abort: AbortController }>();
  /** Set by shutdown(): no new build may start once running builds are being stopped. */
  private closing = false;
  private readonly listeners = new Set<(event: BuildEvent) => void>();
  /** Default language of old builds (no BuildReport.entry), read once from their commit. */
  private readonly languages = new Map<string, string | null>();

  constructor(private readonly opts: BuildServiceOptions) {
    this.store = new BuildStore(opts.db);
    const interrupted = this.store.closeInterrupted();
    if (interrupted > 0) opts.logger.log("warn", "build.interrupted", { count: interrupted });
    // The first preview build of a new or imported site (plan 5.2 step 5), whoever adds the site.
    opts.sites.onAdded((site) => this.startAfterAdd(site));
    opts.changes.subscribe((siteId) => {
      if (opts.changes.store.open(siteId)) return;
      opts.previews
        .close(PreviewPool.key(siteId, "change"))
        .catch((err) => opts.logger.log("warn", "build.preview_close_failed", { siteId, error: String(err) }));
    });
  }

  /** Listen to build starts and ends (for the event stream); returns the function that stops listening. */
  onEvent(listener: (event: BuildEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(type: BuildEvent["type"], id: string): void {
    const record = this.store.get(id);
    if (!record) return;
    const build = publicBuild(record);
    for (const listener of this.listeners) {
      try {
        listener({ type, build });
      } catch (err) {
        this.opts.logger.log("error", "build.listener_failed", { error: String(err) });
      }
    }
  }

  /** Newest first, without reports (they can be large and the UI polls this); see `get`. */
  list(siteId: string): Build[] {
    this.opts.sites.get(siteId);
    return this.store.list(siteId, LIST_LIMIT).map((b) => ({ ...publicBuild(b), report: null }));
  }

  /** One build with its report. */
  get(siteId: string, buildId: string): Build {
    this.opts.sites.get(siteId);
    const build = this.store.get(buildId);
    if (!build || build.siteId !== siteId) throw new SiteError("build.not_found", 404);
    return publicBuild(build);
  }

  /**
   * Start a build and return it as `running`; it finishes in the background (poll the list).
   * `guardedCommit`: a commit the pre-build guard passed moments ago, so it is not scanned twice.
   */
  async start(siteId: string, ref: PanelRef, opts: { guardedCommit?: string } = {}): Promise<Build> {
    this.assertOpen();
    const site = this.opts.sites.get(siteId);
    if (site.readOnly) throw new SiteError("site.read_only", 409);
    if (ref === "change" && !this.opts.changes.store.open(siteId)) throw new SiteError("change.not_found", 404);
    const runner = await usableRunner(this.opts.bukit, this.runnerOpts());
    if (!runner) throw new SiteError("build.bukit_missing", 409);

    const release = this.opts.locks.acquire(siteId, "build");
    try {
      let target: Target;
      if (ref === "change") {
        // Under the lock: the change set may have closed, and the checkout is snapshotted as it is.
        const change = this.opts.changes.store.open(siteId);
        if (!change) throw new SiteError("change.not_found", 404);
        const cwd = await this.opts.sites.aiWorktree(siteId, change.snapshotCommit, { reset: false });
        const { commit } = await this.opts.changes.snapshot(siteId, cwd);
        target = { ref, commit, cwd, changeSetId: change.id };
      } else {
        target = { ref, commit: await this.opts.sites.headOf(site), cwd: null, changeSetId: null };
      }
      this.assertOpen(); // shutdown may have begun while the branch was resolved
      const id = newBuildId();
      this.store.insert({ id, siteId, commit: target.commit, changeSetId: target.changeSetId });
      const abort = new AbortController();
      const guarded = ref === "main" && opts.guardedCommit === target.commit;
      const promise = this.execute(site, id, target, runner, abort.signal, guarded)
        .catch((err) => this.opts.logger.log("error", "build.crashed", { id, error: String(err) }))
        .finally(() => {
          this.running.delete(id);
          release();
          try {
            this.emit("build.end", id);
          } catch (err) {
            // A storage error while reading the final record must not become an unhandled rejection.
            this.opts.logger.log("error", "build.end_failed", { id, error: String(err) });
          }
        });
      this.running.set(id, { promise, abort });
      this.emit("build.start", id);
      return publicBuild(this.store.get(id) as BuildRecord);
    } catch (err) {
      release();
      throw err;
    }
  }

  /**
   * The preview build of a site that was just created or imported (plan 5.2 step 5). Only for a usable
   * site whose `config check` passed; a busy site or a missing Bukit is not an error for the caller.
   */
  async startAfterAdd(site: Site): Promise<void> {
    if (site.readOnly !== null || site.configCheck !== "ok") return;
    try {
      // The site check that just finished guarded checkedCommit; a newer head is guarded as usual.
      await this.start(site.id, "main", { guardedCommit: site.checkedCommit ?? undefined });
    } catch (err) {
      this.opts.logger.log("warn", "build.after_add_skipped", { siteId: site.id, error: String(err) });
    }
  }

  /** Open (or re-point) the site's preview port at its newest kept build. */
  async openPreview(siteId: string, ref: PanelRef): Promise<PreviewResponse> {
    const site = this.opts.sites.get(siteId);
    if (ref === "change" && !this.opts.changes.store.open(siteId)) throw new SiteError("change.not_found", 404);
    const key = PreviewPool.key(siteId, ref);
    let build = this.newestOutput(siteId, ref);
    if (!build) throw new SiteError("preview.not_built", 404);
    let port: number;
    let url: string;
    try {
      ({ port, url } = await this.opts.previews.open(key, build.outputDir, await this.entryOf(site.path, build)));
    } catch (err) {
      if (err instanceof NoPreviewPortError) throw new SiteError("preview.no_port", 503);
      throw err;
    }
    // A build that succeeded while the port was being bound (or the entry looked up) could not re-point the
    // slot yet. Re-point only if it is still the newest after the lookup, so an older build never wins.
    for (let newest = this.newestOutput(siteId, ref); newest && newest.id !== build.id; ) {
      const entry = await this.entryOf(site.path, newest);
      const now = this.newestOutput(siteId, ref);
      if (now?.id === newest.id) {
        this.opts.previews.repoint(key, newest.outputDir, entry);
        build = newest;
      }
      newest = now;
    }
    return { ref, url, port, buildId: build.id, commit: build.commit };
  }

  /**
   * The newest kept output of `ref` that is still on disk; outputs deleted from outside are forgotten.
   * For `change`, only builds of the open change set count.
   */
  private newestOutput(siteId: string, ref: PanelRef): (BuildRecord & { outputDir: string }) | null {
    const changeSetId = ref === "change" ? (this.opts.changes.store.open(siteId)?.id ?? null) : null;
    if (ref === "change" && changeSetId === null) return null;
    for (const build of this.store.withOutput(siteId)) {
      if (build.ref !== ref || !build.outputDir) continue;
      if (ref === "change" && build.changeSetId !== changeSetId) continue;
      if (fs.existsSync(build.outputDir)) return { ...build, outputDir: build.outputDir };
      this.store.dropOutput(build.id);
    }
    return null;
  }

  /** A site was removed: give back its preview ports (its records go with the site row). */
  forgetSite(siteId: string): Promise<void> {
    return this.opts.previews.closeSite(siteId);
  }

  /** Wait for the running builds. */
  async settled(): Promise<void> {
    await Promise.all([...this.running.values()].map((r) => r.promise));
  }

  /** Stop running builds (Bukit gets SIGINT and rolls back) and wait for them, at server shutdown. */
  async shutdown(): Promise<void> {
    this.closing = true;
    for (const r of this.running.values()) r.abort.abort();
    await this.settled();
  }

  // --- internals ---

  private assertOpen(): void {
    if (this.closing) throw new SiteError("server.shutting_down", 503);
  }

  private runnerOpts() {
    return { git: this.opts.git, home: this.opts.paths.home, tmpDir: this.opts.paths.bukitTmp };
  }

  private async execute(
    site: Site,
    id: string,
    target: Target,
    runner: BukitRunner,
    signal: AbortSignal,
    guarded: boolean,
  ) {
    const { commit } = target;
    const finish = (
      status: Exclude<BuildStatus, "running">,
      outcome: BuildOutcome,
      exitCode: number | null,
      report: Partial<BuildReport>,
      outputDir: string | null = null,
    ) => this.store.finish(id, { status, outcome, exitCode }, { messages: [], output: "", ...report }, outputDir);

    let temp: string | null = null;
    // Unreviewed (change) builds never get the Notion token; a main build of the reviewed version may.
    const notionToken = target.ref === "main" ? this.opts.secrets.get("notion") : null;
    let passNotionToken = false;
    try {
      // The guard reads the commit's git objects, so it judges exactly what the checkout will hold.
      if (!guarded) {
        const guard = await guardCommit(this.opts.git, site.path, commit);
        // The site's state follows what the guard found on the default branch, so the UI stops offering
        // builds; what the AI changed only fails its own build (the review shows why).
        if (target.ref === "main" && (!guard.ok || guard.usesNotion))
          this.opts.sites.applyGuard(site.id, commit, guard);
        if (!guard.ok) return finish("failed", "refused", null, { reasons: guard.reasons });
        if (guard.usesNotion && notionToken === null) return finish("failed", "notion", null, {});
        passNotionToken = guard.usesNotion;
      }

      const checkout = target.cwd ?? (await this.opts.sites.mainCheckout(site.id, site.path, commit));
      temp = path.join(checkout, BUILD_OUTPUT_PARENT, id);
      fs.rmSync(temp, { recursive: true, force: true });
      const result = await runner.run("build", buildArgs(id), {
        cwd: checkout,
        signal,
        ...(passNotionToken && notionToken !== null ? { env: { NOTION_TOKEN: notionToken } } : {}),
      });
      const report = buildReport(result);
      const outcome = buildOutcome(result);
      if (outcome !== "ok") {
        const problem = storageErrorInText([report.output, ...report.messages.map((m) => m.msg)].join("\n"));
        return finish("failed", outcome, result.exitCode, problem ? { ...report, problem } : report);
      }
      if (!fs.lstatSync(temp, { throwIfNoEntry: false })?.isDirectory()) {
        return finish("failed", "error", result.exitCode, { ...report, detail: "bukit wrote no output directory" });
      }
      // The preview server refuses symlinks too, but a build that made one is not kept at all (plan 8.4).
      const link = findSymlink(temp);
      if (link) return finish("failed", "symlink", result.exitCode, { ...report, detail: link });

      const dest = path.join(this.opts.paths.previews, site.id, id);
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
      moveDir(temp, dest);
      temp = null;
      const audit = this.audit(site.id, id, dest);
      const entry = previewEntry(dest, checkoutLanguage(checkout));
      finish(
        "succeeded",
        "ok",
        result.exitCode,
        { ...report, ...(audit ? { audit } : {}), ...(entry ? { entry } : {}) },
        dest,
      );
      // An open preview switches to the new build at once (a change preview: while its change set is open).
      if (target.ref === "main" || this.opts.changes.store.open(site.id)?.id === target.changeSetId) {
        this.opts.previews.repoint(PreviewPool.key(site.id, target.ref), dest, entry);
      }
    } catch (err) {
      const problem = storageErrorCode(err) ?? undefined;
      finish("failed", "error", null, {
        detail: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        ...(problem ? { problem } : {}),
      });
    } finally {
      if (temp) fs.rmSync(temp, { recursive: true, force: true });
      this.prune(site.id);
    }
  }

  /**
   * Where the preview of `build` opens. Builds from before BuildReport.entry existed work it out from the
   * site.yaml of the built commit; git is asked only when the output has no root home page, once per build.
   */
  private async entryOf(repo: string, build: BuildRecord & { outputDir: string }): Promise<string | undefined> {
    if (build.report?.entry) return build.report.entry;
    const homes = homePages(build.outputDir);
    if (homes.length === 0) return undefined;
    let lang = this.languages.get(build.id);
    if (lang === undefined) {
      lang = await this.languageAt(repo, build.commit);
      if (this.languages.size >= MAX_CACHED_LANGUAGES) this.languages.clear();
      this.languages.set(build.id, lang);
    }
    return pickEntry(homes, lang);
  }

  /** The default language in site.yaml at `commit`, or null when it cannot be read. */
  private async languageAt(repo: string, commit: string): Promise<string | null> {
    try {
      const text = await readBlobAt(this.opts.git, repo, commit, "site.yaml", MAX_SITE_YAML);
      return text ? siteLanguage(text.toString("utf8")) : null;
    } catch {
      return null;
    }
  }

  /** The SEO / GEO summary of a kept output (M4 layer 7); a report that cannot be read never fails the build. */
  private audit(siteId: string, buildId: string, outputDir: string): BuildAudit | null {
    try {
      return readAudit(outputDir);
    } catch (err) {
      this.opts.logger.log("warn", "build.audit_unreadable", { siteId, buildId, error: String(err) });
      return null;
    }
  }

  /**
   * Keep the newest KEEP_OUTPUTS outputs, plus the newest of each ref and whatever an open preview
   * serves; delete the others and forget old records.
   */
  private prune(siteId: string): void {
    try {
      const keep = new Set<string>();
      for (const ref of ["main", "change"] as const) {
        const latest = this.store.latestWithOutput(siteId, ref);
        if (latest) keep.add(latest.id);
      }
      const served = new Set(
        (["main", "change"] as const).map((ref) => this.opts.previews.rootOf(PreviewPool.key(siteId, ref))),
      );
      const siteDir = path.join(this.opts.paths.previews, siteId);
      for (const [i, build] of this.store.withOutput(siteId).entries()) {
        if (i < KEEP_OUTPUTS || keep.has(build.id) || served.has(build.outputDir)) continue;
        if (build.outputDir && path.dirname(build.outputDir) === siteDir) {
          fs.rmSync(build.outputDir, { recursive: true, force: true });
        }
        this.store.dropOutput(build.id);
      }
      this.store.pruneRecords(siteId, KEEP_RECORDS);
    } catch (err) {
      this.opts.logger.log("warn", "build.prune_failed", { siteId, error: String(err) });
    }
  }
}

/** What a build runs on: the default branch head in main/, or a change set's snapshot in ai/. */
type Target =
  | { ref: "main"; commit: string; cwd: null; changeSetId: null }
  | { ref: "change"; commit: string; cwd: string; changeSetId: string };

function publicBuild(record: BuildRecord): Build {
  const { outputDir: _, changeSetId: __, ...build } = record;
  return build;
}

const ERROR_LEVELS = new Set(["error", "fatal", "critical"]);
const MESSAGE_LEVELS = new Set(["warn", "warning", ...ERROR_LEVELS]);
/**
 * Log lines that repeat the SEO / GEO reports, shown in the audit summary instead: one per issue
 * ("seo.audit severity=warning code=…"), the per-kind counts ("event=diagnostics.summary kind=seo.audit:…")
 * and the missing site.url note.
 */
const AUDIT_LOG_LINE =
  /^(?:(?:seo|publish|geo)\.audit severity=|event=diagnostics\.summary kind=(?:seo|publish|geo)\.audit:|seo\.site_url_missing\b)/;

/** Warnings and errors from the JSON log (stderr or stdout), and the end of everything else Bukit printed. */
export function buildReport(result: BukitRunResult): BuildReport {
  const messages: BuildReport["messages"] = [];
  const other: string[] = [];
  // Bukit 2.0.x writes its JSON log to stderr (stdout stays empty); read both, log lines first from stderr.
  for (const line of `${result.stderr}\n${result.stdout}`.split("\n")) {
    const entry = logEntry(line);
    if (!entry) {
      if (line.trim() !== "") other.push(line);
      continue;
    }
    // Every SEO issue is also logged as a warning; the audit summary lists them grouped (M4 layer 7).
    // Errors stay: the summary is read only for a succeeded build, so a failed one must still show them.
    if (AUDIT_LOG_LINE.test(entry.msg) && !ERROR_LEVELS.has(entry.level.toLowerCase())) continue;
    if (MESSAGE_LEVELS.has(entry.level.toLowerCase())) {
      messages.push({ level: entry.level, msg: entry.msg.slice(0, MAX_MESSAGE_CHARS) });
    }
  }
  return { messages: limitMessages(messages, MAX_MESSAGES), output: other.join("\n").slice(-MAX_OUTPUT_CHARS) };
}

/**
 * At most `max` messages in their original order, errors first in line: an error usually comes last, after
 * the warnings, and is the one message that says why a build failed.
 */
export function limitMessages(messages: BuildReport["messages"], max: number): BuildReport["messages"] {
  if (messages.length <= max) return messages;
  const isError = (m: BuildReport["messages"][number]) => ERROR_LEVELS.has(m.level.toLowerCase());
  const errors = messages.filter(isError);
  // More errors than room: keep the last ones. The final error is usually the one that explains the failure.
  if (errors.length >= max) return errors.slice(-max);
  let warningRoom = max - errors.length;
  let errorRoom = errors.length;
  return messages.filter((m) => {
    if (isError(m)) return errorRoom-- > 0;
    return warningRoom-- > 0;
  });
}

const HOME_DIR = /^[A-Za-z0-9][A-Za-z0-9_-]{0,34}$/;
const MAX_SITE_YAML = 1024 * 1024;
/** Old builds whose default language was read from git; cleared when full. */
const MAX_CACHED_LANGUAGES = 200;

/**
 * Where a preview opens when the output has no index.html at its root. Bukit 2.0.12 writes a multilingual
 * site under /<lang>/ only, so "/" would be a blank 404; it goes to `lang`'s home (the site's default
 * language), else to the first folder with a home page. Never fails a build.
 */
export function previewEntry(outputDir: string, lang: string | null): string | undefined {
  return pickEntry(homePages(outputDir), lang);
}

/** The language folders with a home page, sorted; none when the output has its own root home page or cannot be read. */
function homePages(outputDir: string): string[] {
  try {
    if (fs.lstatSync(path.join(outputDir, "index.html"), { throwIfNoEntry: false })) return [];
    return fs
      .readdirSync(outputDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && HOME_DIR.test(d.name))
      .filter((d) => fs.lstatSync(path.join(outputDir, d.name, "index.html"), { throwIfNoEntry: false })?.isFile())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function pickEntry(homes: string[], lang: string | null): string | undefined {
  if (homes.length === 0) return undefined;
  return `/${lang && homes.includes(lang) ? lang : homes[0]}/`;
}

/** site.defaultLanguage, else site.language, from site.yaml text; null when neither is a string. */
export function siteLanguage(yaml: string): string | null {
  const { value } = parseYaml(yaml);
  const site = isRecord(value) && isRecord(value.site) ? value.site : null;
  const lang = site?.defaultLanguage ?? site?.language;
  return typeof lang === "string" ? lang : null;
}

/** The default language of the checkout that was just built. */
export function checkoutLanguage(checkout: string): string | null {
  try {
    const file = path.join(checkout, "site.yaml");
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > MAX_SITE_YAML) return null;
    return siteLanguage(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The first symbolic link under `dir`, relative to it, or null. */
export function findSymlink(dir: string, rel = ""): string | null {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) return p;
    if (entry.isDirectory()) {
      const found = findSymlink(dir, p);
      if (found) return found;
    }
  }
  return null;
}

/** Rename, or copy and delete when the two directories are on different file systems. */
function moveDir(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true, errorOnExist: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}
