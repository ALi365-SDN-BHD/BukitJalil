import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  Build,
  BuildOutcome,
  BuildReport,
  BuildStatus,
  PanelRef,
  PreviewResponse,
  Site,
} from "@bukitjalil/shared";
import { guardCommit } from "../bukit/guard.ts";
import type { BukitService } from "../bukit/locate.ts";
import { type BukitRunner, type BukitRunResult, buildOutcome, logEntry, usableRunner } from "../bukit/runner.ts";
import type { GitRunner } from "../git/run.ts";
import type { Logger } from "../log.ts";
import type { AppPaths } from "../paths.ts";
import { NoPreviewPortError, PreviewPool } from "../preview/pool.ts";
import { SiteError } from "../sites/location.ts";
import type { SiteLocks } from "../sites/locks.ts";
import type { SiteService } from "../sites/service.ts";
import { type BuildRecord, BuildStore, newBuildId } from "./store.ts";

export interface BuildServiceOptions {
  db: DatabaseSync;
  git: GitRunner;
  paths: AppPaths;
  sites: SiteService;
  bukit: BukitService;
  locks: SiteLocks;
  previews: PreviewPool;
  logger: Logger;
}

/** Kept build outputs per site, besides the ones a preview shows (plan 8.4). */
export const KEEP_OUTPUTS = 10;
const KEEP_RECORDS = 50;
const LIST_LIMIT = 50;
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 2000;
const MAX_OUTPUT_CHARS = 8000;
const OUTPUT_PARENT = ".bukitjalil-build";

/**
 * Builds and previews (plan 8.3, 8.4). A main build runs in worktrees/<siteId>/main at the default
 * branch head, never in the site directory: the commit passes the pre-build guard, Bukit writes into a
 * fresh .bukitjalil-build/<buildId>/ with --no-clean, and a successful output without symlinks moves to
 * previews/<siteId>/<buildId>/. The site lock is held for the whole build.
 */
export class BuildService {
  readonly store: BuildStore;
  private readonly running = new Map<string, { promise: Promise<void>; abort: AbortController }>();
  /** Set by shutdown(): no new build may start once running builds are being stopped. */
  private closing = false;

  constructor(private readonly opts: BuildServiceOptions) {
    this.store = new BuildStore(opts.db);
    const interrupted = this.store.closeInterrupted();
    if (interrupted > 0) opts.logger.log("warn", "build.interrupted", { count: interrupted });
    // The first preview build of a new or imported site (plan 5.2 step 5), whoever adds the site.
    opts.sites.onAdded((site) => this.startAfterAdd(site));
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
    // Change set builds run in the ai/ checkout and arrive with change sets in M4.
    if (ref === "change") throw new SiteError("change.not_found", 404);
    if (site.readOnly) throw new SiteError("site.read_only", 409);
    const runner = await usableRunner(this.opts.bukit, this.runnerOpts());
    if (!runner) throw new SiteError("build.bukit_missing", 409);

    const release = this.opts.locks.acquire(siteId, "build");
    try {
      const commit = await this.opts.sites.headOf(site);
      this.assertOpen(); // shutdown may have begun while the branch was resolved
      const id = newBuildId();
      this.store.insert({ id, siteId, commit });
      const abort = new AbortController();
      const guarded = opts.guardedCommit === commit;
      const promise = this.execute(site, id, commit, runner, abort.signal, guarded)
        .catch((err) => this.opts.logger.log("error", "build.crashed", { id, error: String(err) }))
        .finally(() => {
          this.running.delete(id);
          release();
        });
      this.running.set(id, { promise, abort });
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
    this.opts.sites.get(siteId);
    if (ref === "change") throw new SiteError("change.not_found", 404);
    const key = PreviewPool.key(siteId, ref);
    let build = this.newestOutput(siteId, ref);
    if (!build) throw new SiteError("preview.not_built", 404);
    let port: number;
    let url: string;
    try {
      ({ port, url } = await this.opts.previews.open(key, build.outputDir));
    } catch (err) {
      if (err instanceof NoPreviewPortError) throw new SiteError("preview.no_port", 503);
      throw err;
    }
    // A build that succeeded while the port was being bound could not re-point the slot yet.
    const newest = this.newestOutput(siteId, ref);
    if (newest && newest.id !== build.id) {
      this.opts.previews.repoint(key, newest.outputDir);
      build = newest;
    }
    return { ref, url, port, buildId: build.id, commit: build.commit };
  }

  /** The newest kept output of `ref` that is still on disk; outputs deleted from outside are forgotten. */
  private newestOutput(siteId: string, ref: PanelRef): (BuildRecord & { outputDir: string }) | null {
    for (const build of this.store.withOutput(siteId)) {
      if (build.ref !== ref || !build.outputDir) continue;
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
    commit: string,
    runner: BukitRunner,
    signal: AbortSignal,
    guarded: boolean,
  ) {
    const finish = (
      status: Exclude<BuildStatus, "running">,
      outcome: BuildOutcome,
      exitCode: number | null,
      report: Partial<BuildReport>,
      outputDir: string | null = null,
    ) => this.store.finish(id, { status, outcome, exitCode }, { messages: [], output: "", ...report }, outputDir);

    let temp: string | null = null;
    try {
      // The guard reads the commit's git objects, so it judges exactly what the checkout will hold.
      if (!guarded) {
        const guard = await guardCommit(this.opts.git, site.path, commit);
        // The site's state follows what the guard just found, so the UI stops offering builds.
        if (!guard.ok || guard.usesNotion) this.opts.sites.applyGuard(site.id, commit, guard);
        if (!guard.ok) return finish("failed", "refused", null, { reasons: guard.reasons });
        // A main build may pass NOTION_TOKEN (plan 8.5), but tokens are only stored from M6.
        if (guard.usesNotion) return finish("failed", "notion", null, {});
      }

      const checkout = await this.opts.sites.mainCheckout(site.id, site.path, commit);
      temp = path.join(checkout, OUTPUT_PARENT, id);
      fs.rmSync(temp, { recursive: true, force: true });
      const result = await runner.run(
        "build",
        [
          "build",
          "--config",
          "site.yaml",
          "--output",
          `${OUTPUT_PARENT}/${id}`,
          "--base-url",
          "/",
          "--no-clean",
          "--log-format",
          "json",
        ],
        { cwd: checkout, signal },
      );
      const report = buildReport(result);
      const outcome = buildOutcome(result);
      if (outcome !== "ok") return finish("failed", outcome, result.exitCode, report);
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
      finish("succeeded", "ok", result.exitCode, report, dest);
      // An open preview switches to the new build at once.
      this.opts.previews.repoint(PreviewPool.key(site.id, "main"), dest);
    } catch (err) {
      finish("failed", "error", null, { detail: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    } finally {
      if (temp) fs.rmSync(temp, { recursive: true, force: true });
      this.prune(site.id);
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

function publicBuild(record: BuildRecord): Build {
  const { outputDir: _, ...build } = record;
  return build;
}

const MESSAGE_LEVELS = new Set(["warn", "warning", "error", "fatal", "critical"]);

/** Warnings and errors from the JSON log, and the end of everything else Bukit printed. */
export function buildReport(result: BukitRunResult): BuildReport {
  const messages: BuildReport["messages"] = [];
  const other: string[] = [];
  for (const line of result.stdout.split("\n")) {
    const entry = logEntry(line);
    if (!entry) {
      if (line.trim() !== "") other.push(line);
      continue;
    }
    if (MESSAGE_LEVELS.has(entry.level.toLowerCase()) && messages.length < MAX_MESSAGES) {
      messages.push({ level: entry.level, msg: entry.msg.slice(0, MAX_MESSAGE_CHARS) });
    }
  }
  const output = [result.stderr.trimEnd(), other.join("\n")].filter((s) => s !== "").join("\n");
  return { messages, output: output.slice(-MAX_OUTPUT_CHARS) };
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
