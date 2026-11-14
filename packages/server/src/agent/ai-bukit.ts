import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ApplyCheck, BuildAudit, NotionOfflineData, NotionSnapshotProblem } from "@bukitjalil/shared";
import { readAudit } from "../builds/audit.ts";
import { BUILD_OUTPUT_PARENT, buildArgs, buildReport, limitMessages, notionOfflineData } from "../builds/service.ts";
import { type GuardReason, guardCommit } from "../bukit/guard.ts";
import type { BukitService } from "../bukit/locate.ts";
import { notionSnapshotProblemIn } from "../bukit/notion-errors.ts";
import { type BukitRunner, type BukitRunResult, buildOutcome, checkPassed, usableRunner } from "../bukit/runner.ts";
import type { ChangeService } from "../changes/service.ts";
import type { Snapshot } from "../changes/snapshot.ts";
import type { GitRunner } from "../git/run.ts";
import type { AppPaths } from "../paths.ts";
import { checkoutBasePath } from "../preview/base-path.ts";
import type { OfflineNotion } from "../sites/notion-snapshots.ts";
import type { SiteService } from "../sites/service.ts";

/**
 * Bukit for the AI (plan 6.3, 8.5): `bukit_check` and `bukit_build` run in the site's ai/ checkout. Each
 * call snapshots the checkout into a commit (through the change set, plan 7.2), passes the pre-build guard
 * on that commit and only then starts Bukit, with no secrets. A Notion site is checked and built offline
 * from the Notion offline snapshot of its last formal build (plan 5.5). A multilingual build needs the clean
 * checkout the snapshot leaves (plan 7.2). The tools only run inside an AI run, which holds the site lock
 * until `settled` says they have all ended.
 */

const MAX_STEP_OUTPUT = 6000;
const MAX_SCHEMA_BYTES = 4 * 1024 * 1024;

/** A refusal before Bukit runs, with what the AI should do about it. */
export class AiBukitError extends Error {
  constructor(
    readonly code: "read_only" | "bukit_missing" | "guard" | "notion",
    message: string,
    readonly reasons: GuardReason[] = [],
  ) {
    super(message);
    this.name = "AiBukitError";
  }
}

export interface CheckStep {
  command: "config check" | "doctor";
  passed: boolean;
  exitCode: number;
  stopped: BukitRunResult["stopped"];
  output: string;
}

export type { Snapshot };

/** Where the Notion data of an offline check or build came from, and why it could not be used (plan 5.5). */
export interface NotionNote extends NotionOfflineData {
  problem: NotionSnapshotProblem | null;
}

export interface CheckResult {
  passed: boolean;
  commit: string;
  removed: string[];
  steps: CheckStep[];
  /** A Notion site, checked from its snapshot. */
  notion?: NotionNote;
}

export interface BuildResult {
  /** Bukit's outcome, or "base_url" when site.baseUrl is not a path a preview can be served under. */
  outcome: ReturnType<typeof buildOutcome> | "base_url";
  commit: string;
  removed: string[];
  exitCode: number;
  pages: number;
  messages: { level: string; msg: string }[];
  output: string;
  /** SEO / GEO summary of a successful build (M4 layer 7), read before the output is deleted. */
  audit: BuildAudit | null;
  /** A Notion site, built from its snapshot. */
  notion?: NotionNote;
}

export interface AiBukitOptions {
  git: GitRunner;
  paths: AppPaths;
  sites: SiteService;
  bukit: BukitService;
  changes: ChangeService;
}

export class AiBukit {
  /** Keyed by path and version: Bukit may be replaced in place at a custom path. */
  private schema: { key: string; value: Promise<unknown> } | null = null;
  /** siteId -> checks and builds still running there (the site lock must outlive them). */
  private readonly inflight = new Map<string, Set<Promise<unknown>>>();

  constructor(private readonly opts: AiBukitOptions) {}

  /**
   * Resolves once every check and build of the site has ended, the Bukit process included. A run waits for
   * this before it lets go of the site lock: stopping a run aborts its tools, and Pi may finish the prompt
   * before an aborted Bukit has exited (it gets SIGINT, then is killed after a grace period).
   */
  async settled(siteId: string): Promise<void> {
    for (;;) {
      const calls = this.inflight.get(siteId);
      if (!calls || calls.size === 0) return;
      await Promise.allSettled([...calls]);
    }
  }

  /**
   * `config check`, then `doctor` (it finds content and template errors check does not; plan 8.2). With
   * `commit`, `cwd` is a checkout of that commit that is not the AI's: it is guarded as it is, not
   * snapshotted (a partial apply, plan 7.5).
   */
  check(siteId: string, cwd: string, signal?: AbortSignal, commit?: string): Promise<CheckResult> {
    return this.guarded(siteId, cwd, commit, async (runner, { commit, removed }, offline) => {
      const steps: CheckStep[] = [];
      const extra = offline?.checkArgs ?? [];
      const results: BukitRunResult[] = [];
      for (const [command, args] of [
        ["config check", ["config", "check", "--config", "site.yaml", ...extra]],
        ["doctor", ["doctor", "--config", "site.yaml", ...extra]],
      ] as const) {
        const result = await runner.run(command === "doctor" ? "doctor" : "check", args, {
          cwd,
          signal,
          redact: this.redact,
        });
        results.push(result);
        steps.push({
          command,
          passed: checkPassed(result),
          exitCode: result.exitCode,
          stopped: result.stopped,
          output: tail(`${result.stdout.trimEnd()}\n${result.stderr.trimEnd()}`.trim(), MAX_STEP_OUTPUT),
        });
        if (result.stopped) break;
      }
      const passed = steps.length === 2 && steps.every((s) => s.passed);
      return { passed, commit, removed, steps, ...(offline ? { notion: notionNote(offline, results, passed) } : {}) };
    });
  }

  /**
   * The check before applying a change set (plan 7.2), with the site lock held by the caller: like
   * bukit_check, but a refusal (no Bukit, the pre-build guard) is a failed check the user may override.
   */
  async checkForApply(siteId: string, cwd: string, commit?: string): Promise<ApplyCheck> {
    try {
      const { passed, steps, notion } = await this.check(siteId, cwd, undefined, commit);
      // A snapshot that cannot answer for this commit leaves it unchecked, like a Notion site without one.
      const unchecked = notion?.problem ? NOTION_TEXT[notion.problem] : null;
      return {
        passed,
        problemCode: unchecked ? "notion" : null,
        problem: unchecked,
        steps: steps.map(({ command, passed, exitCode, output }) => ({ command, passed, exitCode, output })),
      };
    } catch (err) {
      if (!(err instanceof AiBukitError)) throw err;
      return { passed: false, problemCode: err.code, problem: err.message, steps: [] };
    }
  }

  /** Build into a fresh .bukitjalil-build/ai-<id>/ and report, with its SEO / GEO summary; the output is deleted. */
  build(siteId: string, cwd: string, signal?: AbortSignal): Promise<BuildResult> {
    return this.guarded(siteId, cwd, undefined, async (runner, { commit, removed }, offline) => {
      // Built under the site's own baseUrl, as the preview of the change will be (plan 16 #8).
      const base = checkoutBasePath(cwd);
      if (!base.ok) {
        const msg = `${base.detail}; the preview cannot be served, fix site.baseUrl`;
        return {
          outcome: "base_url",
          commit,
          removed,
          exitCode: -1,
          pages: 0,
          messages: [{ level: "error", msg }],
          output: "",
          audit: null,
        };
      }
      const name = `ai-${crypto.randomBytes(6).toString("hex")}`;
      const out = path.join(cwd, BUILD_OUTPUT_PARENT, name);
      try {
        const args = [...buildArgs(name, base.basePath), ...(offline?.buildArgs ?? [])];
        const result = await runner.run("build", args, { cwd, signal, redact: this.redact });
        const report = buildReport(result);
        const outcome = buildOutcome(result);
        return {
          ...(offline ? { notion: notionNote(offline, [result], outcome === "ok") } : {}),
          outcome,
          commit,
          removed,
          exitCode: result.exitCode,
          pages: outcome === "ok" ? countPages(out) : 0,
          messages: limitMessages(report.messages, 50),
          output: tail(report.output, MAX_STEP_OUTPUT),
          audit: outcome === "ok" ? readAuditQuietly(out) : null,
        };
      } finally {
        fs.rmSync(out, { recursive: true, force: true });
      }
    });
  }

  /** `bukit config schema`, cached per Bukit executable. It reads no site files, so it needs no guard. */
  async configSchema(): Promise<unknown> {
    const runner = await this.runner();
    const status = await this.opts.bukit.status();
    const key = `${status.path}\0${status.version}`;
    if (this.schema?.key !== key) {
      const value = this.readSchema(runner);
      value.catch(() => {
        if (this.schema?.value === value) this.schema = null;
      });
      this.schema = { key, value };
    }
    return this.schema.value;
  }

  // --- internals ---

  private get redact() {
    return this.opts.sites.notionSnapshots.redact;
  }

  /**
   * Snapshot (or, with `commit`, take that commit as it is) and guard, then run `fn` with a runner; any
   * refusal is an AiBukitError.
   */
  private guarded<T>(
    siteId: string,
    cwd: string,
    commit: string | undefined,
    fn: (runner: BukitRunner, snapshot: Snapshot, offline: OfflineNotion | null) => Promise<T>,
  ): Promise<T> {
    const call = this.guardedCall(siteId, cwd, commit, fn);
    const calls = this.inflight.get(siteId) ?? new Set();
    this.inflight.set(siteId, calls);
    calls.add(call);
    const done = () => {
      calls.delete(call);
      if (calls.size === 0 && this.inflight.get(siteId) === calls) this.inflight.delete(siteId);
    };
    call.then(done, done);
    return call;
  }

  private async guardedCall<T>(
    siteId: string,
    cwd: string,
    commit: string | undefined,
    fn: (runner: BukitRunner, snapshot: Snapshot, offline: OfflineNotion | null) => Promise<T>,
  ): Promise<T> {
    const site = this.opts.sites.get(siteId);
    if (site.readOnly) throw new AiBukitError("read_only", "The site is read-only, so Bukit cannot run on it.");
    const runner = await this.runner();
    const snapshot = commit ? { commit, removed: [] } : await this.opts.changes.snapshot(siteId, cwd);
    const guard = await guardCommit(this.opts.git, site.path, snapshot.commit);
    if (!guard.ok) {
      throw new AiBukitError(
        "guard",
        `The pre-build safety check refused the site: ${guard.reasons.map(describeReason).join("; ")}`,
        guard.reasons,
      );
    }
    // Unreviewed content never gets secrets (plan 8.5): a Notion source is read from the snapshot of the last
    // formal build instead, with no token and no network (plan 5.5).
    let offline: OfflineNotion | null = null;
    if (guard.usesNotion) {
      offline = this.opts.sites.notionSnapshots.offline(siteId);
      if (!offline) throw new AiBukitError("notion", NOTION_TEXT.missing);
    }
    return fn(runner, snapshot, offline);
  }

  private async runner(): Promise<BukitRunner> {
    const runner = await usableRunner(this.opts.bukit, {
      git: this.opts.git,
      home: this.opts.paths.home,
      tmpDir: this.opts.paths.bukitTmp,
    });
    if (!runner)
      throw new AiBukitError(
        "bukit_missing",
        "Bukit is not installed or not supported; ask the user to set it up in Settings.",
      );
    return runner;
  }

  private async readSchema(runner: BukitRunner): Promise<unknown> {
    const dir = fs.mkdtempSync(path.join(this.opts.paths.bukitTmp, "schema-"));
    try {
      const file = path.join(dir, "schema.json");
      const result = await runner.run("schema", ["config", "schema", "--output", file], { cwd: dir });
      if (!checkPassed(result)) throw new Error(`bukit config schema failed (exit ${result.exitCode})`);
      const st = fs.statSync(file);
      if (st.size > MAX_SCHEMA_BYTES) throw new Error("the schema is too large");
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** What the AI (and an unchecked apply) is told about a snapshot that cannot be used. */
const NOTION_TEXT: Record<NotionSnapshotProblem, string> = {
  missing:
    "The site uses a Notion content source. Checks and builds read the Notion data of the last formal build, and there is none yet: ask the user to build the site once from the site page, then try again. If the default branch has no Notion source yet (this change adds the first one), the change can only be checked after the user applies it and builds the site.",
  stale:
    "The Notion data of the last formal build cannot be read by this Bukit: ask the user to build the site once from the site page to record it again.",
  change:
    "The change needs Notion data the last formal build did not read (a changed databaseId, a new Notion source, or content rendering turned on for a source), so it cannot be checked or previewed here; it works once the user applies it and builds the site.",
};

function notionNote(offline: OfflineNotion, results: BukitRunResult[], passed: boolean): NotionNote {
  const merged: BukitRunResult = {
    exitCode: 0,
    stdout: results.map((r) => r.stdout).join("\n"),
    stderr: results.map((r) => r.stderr).join("\n"),
    durationMs: 0,
    stopped: null,
  };
  return { ...notionOfflineData(offline, merged), problem: passed ? null : snapshotProblem(results) };
}

/**
 * The snapshot problem behind a failed check or build, only when every failing step failed for it: a step
 * that failed for another reason is a real failure, which an unchecked apply must not let through.
 */
function snapshotProblem(results: BukitRunResult[]): NotionSnapshotProblem | null {
  const problems = results
    .filter((r) => !checkPassed(r))
    .map((r) => notionSnapshotProblemIn(`${r.stderr}\n${r.stdout}`));
  if (problems.length === 0 || problems.some((p) => p === null)) return null;
  return problems.includes("change") ? "change" : (problems[0] as NotionSnapshotProblem);
}

/** The AI's note about where Notion data came from, or what to do about it. */
export function notionNoteText(n: NotionNote): string {
  const parts = [
    `Notion content comes from the formal build at ${n.builtAt} (commit ${n.commit.slice(0, 7)}): no token is used and nothing is fetched, so Notion edits made since then do not show.`,
  ];
  if (n.queryChanged) parts.push("The Notion filter or sort changed: the pages are the ones the formal build queried.");
  if (n.rendererMismatch)
    parts.push("Some page bodies were rendered by an older Bukit; a formal build renders them again.");
  if (n.problem) parts.push(NOTION_TEXT[n.problem]);
  return parts.join(" ");
}

export function describeReason(r: GuardReason): string {
  return [r.code, r.where, r.detail].filter(Boolean).join(" ");
}

/** The audit summary, or null when the reports are missing or cannot be read; never fails the build. */
function readAuditQuietly(out: string): BuildAudit | null {
  try {
    return readAudit(out);
  } catch {
    return null;
  }
}

/** HTML pages in a build output (without following links). */
export function countPages(dir: string): number {
  let n = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.isFile() && /\.html?$/i.test(e.name)) n++;
    }
  };
  if (fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) walk(dir);
  return n;
}

const tail = (text: string, max: number) => (text.length > max ? `…${text.slice(-max)}` : text);
