import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BUILD_OUTPUT_PARENT, buildArgs, buildReport } from "../builds/service.ts";
import { type GuardReason, guardCommit } from "../bukit/guard.ts";
import type { BukitService } from "../bukit/locate.ts";
import { type BukitRunner, type BukitRunResult, buildOutcome, checkPassed, usableRunner } from "../bukit/runner.ts";
import type { GitRunner } from "../git/run.ts";
import type { AppPaths } from "../paths.ts";
import { BUILD_DIRS } from "../sites/exclude.ts";
import { SiteError } from "../sites/location.ts";
import type { SiteLocks } from "../sites/locks.ts";
import type { SiteService } from "../sites/service.ts";
import { segmentKey } from "./gate.ts";

/**
 * Bukit for the AI (plan 6.3, 8.5): `bukit_check` and `bukit_build` run in the site's ai/ checkout. Each
 * call holds the site lock, snapshots the checkout into a commit (`add -A`, `write-tree`, `commit-tree`,
 * HEAD moves to it), passes the pre-build guard on that commit and only then starts Bukit, with no secrets.
 * A multilingual build needs the clean checkout the snapshot leaves (plan 7.2).
 */

/** Committer of snapshot commits; they stay inside BukitJalil (the reviewed commit gets the user's identity). */
const SNAPSHOT_IDENTITY = { "user.name": "BukitJalil", "user.email": "ai@bukitjalil.invalid" };
const SNAPSHOT_MESSAGE = "BukitJalil AI snapshot";
/** Ignored files may stay here: build output and caches the AI cannot write (plan 6.3). */
const IGNORED_OK = new Set<string>([...BUILD_DIRS, "node_modules"]);

/**
 * Pathspecs that keep a top-level name out of `git add`, even when .gitignore un-ignores it. The first
 * character is a bracket class: git refuses a pathspec that literally names an ignored path, and a
 * glob without a leading `**` only matches at the top level.
 */
const excludeTopLevel = (name: string) => {
  const glob = `[${name[0]}]${name.slice(1)}`;
  return [`:(exclude,icase,glob)${glob}`, `:(exclude,icase,glob)${glob}/**`];
};
const MAX_STEP_OUTPUT = 6000;
const MAX_SCHEMA_BYTES = 4 * 1024 * 1024;

/** A refusal before Bukit runs, with what the AI should do about it. */
export class AiBukitError extends Error {
  constructor(
    readonly code: "busy" | "read_only" | "bukit_missing" | "guard" | "notion",
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

export interface Snapshot {
  commit: string;
  /** Ignored files deleted before the commit (relative paths; a directory ends in "/"). */
  removed: string[];
}

export interface CheckResult {
  passed: boolean;
  commit: string;
  removed: string[];
  steps: CheckStep[];
}

export interface BuildResult {
  outcome: ReturnType<typeof buildOutcome>;
  commit: string;
  removed: string[];
  exitCode: number;
  pages: number;
  messages: { level: string; msg: string }[];
  output: string;
}

export interface AiBukitOptions {
  git: GitRunner;
  paths: AppPaths;
  sites: SiteService;
  bukit: BukitService;
  locks: SiteLocks;
}

export class AiBukit {
  /** Keyed by path and version: Bukit may be replaced in place at a custom path. */
  private schema: { key: string; value: Promise<unknown> } | null = null;

  constructor(private readonly opts: AiBukitOptions) {}

  /** `config check`, then `doctor` (it finds content and template errors check does not; plan 8.2). */
  check(siteId: string, cwd: string, signal?: AbortSignal): Promise<CheckResult> {
    return this.guarded(siteId, cwd, "ai_check", async (runner, { commit, removed }) => {
      const steps: CheckStep[] = [];
      for (const [command, args] of [
        ["config check", ["config", "check", "--config", "site.yaml"]],
        ["doctor", ["doctor", "--config", "site.yaml"]],
      ] as const) {
        const result = await runner.run(command === "doctor" ? "doctor" : "check", args, { cwd, signal });
        steps.push({
          command,
          passed: checkPassed(result),
          exitCode: result.exitCode,
          stopped: result.stopped,
          output: tail(`${result.stdout.trimEnd()}\n${result.stderr.trimEnd()}`.trim(), MAX_STEP_OUTPUT),
        });
        if (result.stopped) break;
      }
      return { passed: steps.length === 2 && steps.every((s) => s.passed), commit, removed, steps };
    });
  }

  /** Build into a fresh .bukitjalil-build/ai-<id>/ and report; the output is deleted (previews come in M4). */
  build(siteId: string, cwd: string, signal?: AbortSignal): Promise<BuildResult> {
    return this.guarded(siteId, cwd, "ai_build", async (runner, { commit, removed }) => {
      const name = `ai-${crypto.randomBytes(6).toString("hex")}`;
      const out = path.join(cwd, BUILD_OUTPUT_PARENT, name);
      try {
        const result = await runner.run("build", buildArgs(name), { cwd, signal });
        const report = buildReport(result);
        const outcome = buildOutcome(result);
        return {
          outcome,
          commit,
          removed,
          exitCode: result.exitCode,
          pages: outcome === "ok" ? countPages(out) : 0,
          messages: report.messages.slice(0, 50),
          output: tail(report.output, MAX_STEP_OUTPUT),
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

  /**
   * Commit the checkout as it is now (plan 7.2). Files ignored by .gitignore cannot be committed, so the
   * guard would never see them while Bukit reads them: they are deleted first (outside the build
   * directories) and listed in `removed`. They could never reach the site, and the AI has no delete tool.
   * Build directories stay out of the commit even when a .gitignore rule un-ignores them.
   */
  async snapshot(cwd: string): Promise<Snapshot> {
    const { git } = this.opts;
    const removed = (
      await git.text(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], { cwd })
    )
      .split("\0")
      .filter((p) => p !== "" && !IGNORED_OK.has(segmentKey(p.split("/")[0] ?? "")));
    for (const rel of removed) {
      const abs = path.resolve(cwd, rel);
      if (!abs.startsWith(cwd + path.sep)) throw new Error(`git listed a path outside the checkout: ${rel}`);
      fs.rmSync(abs, { recursive: true, force: true });
    }
    await git.run(["add", "-A", "--", ".", ...[...IGNORED_OK].flatMap(excludeTopLevel)], { cwd });
    const tree = (await git.text(["write-tree"], { cwd })).trim();
    const head = (await git.text(["rev-parse", "--verify", "HEAD"], { cwd })).trim();
    const headTree = (await git.text(["rev-parse", "--verify", "HEAD^{tree}"], { cwd })).trim();
    if (tree === headTree) return { commit: head, removed };
    const commit = (
      await git.text(["commit-tree", tree, "-p", head, "-m", SNAPSHOT_MESSAGE], { cwd, config: SNAPSHOT_IDENTITY })
    ).trim();
    await git.run(["update-ref", "--no-deref", "HEAD", commit, head], { cwd });
    return { commit, removed };
  }

  // --- internals ---

  /** Lock, snapshot and guard, then run `fn` with a runner; any refusal is an AiBukitError. */
  private async guarded<T>(
    siteId: string,
    cwd: string,
    operation: string,
    fn: (runner: BukitRunner, snapshot: Snapshot) => Promise<T>,
  ): Promise<T> {
    let release: () => void;
    try {
      release = this.opts.locks.acquire(siteId, operation);
    } catch (err) {
      if (!(err instanceof SiteError)) throw err;
      const busy = err.params.operation ?? "another operation";
      throw new AiBukitError("busy", `The site is busy (${busy}); try again in a moment.`);
    }
    try {
      const site = this.opts.sites.get(siteId);
      if (site.readOnly) throw new AiBukitError("read_only", "The site is read-only, so Bukit cannot run on it.");
      const runner = await this.runner();
      const snapshot = await this.snapshot(cwd);
      const guard = await guardCommit(this.opts.git, site.path, snapshot.commit);
      if (!guard.ok) {
        throw new AiBukitError(
          "guard",
          `The pre-build safety check refused the site: ${guard.reasons.map(describeReason).join("; ")}`,
          guard.reasons,
        );
      }
      // Unreviewed content never gets secrets, and Bukit cannot check a Notion source without one (plan 8.5).
      if (guard.usesNotion) {
        throw new AiBukitError(
          "notion",
          "The site uses a Notion content source, which needs a token that is never given to unreviewed changes. Ask the user to build it from the site page.",
        );
      }
      return await fn(runner, snapshot);
    } finally {
      release();
    }
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

export function describeReason(r: GuardReason): string {
  return [r.code, r.where, r.detail].filter(Boolean).join(" ");
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
