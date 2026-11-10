import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ApplyCheck } from "@bukitjalil/shared";
import { BUILD_OUTPUT_PARENT, buildArgs, buildReport } from "../builds/service.ts";
import { type GuardReason, guardCommit } from "../bukit/guard.ts";
import type { BukitService } from "../bukit/locate.ts";
import { type BukitRunner, type BukitRunResult, buildOutcome, checkPassed, usableRunner } from "../bukit/runner.ts";
import type { ChangeService } from "../changes/service.ts";
import type { Snapshot } from "../changes/snapshot.ts";
import type { GitRunner } from "../git/run.ts";
import type { AppPaths } from "../paths.ts";
import type { SiteService } from "../sites/service.ts";

/**
 * Bukit for the AI (plan 6.3, 8.5): `bukit_check` and `bukit_build` run in the site's ai/ checkout. Each
 * call snapshots the checkout into a commit (through the change set, plan 7.2), passes the pre-build guard
 * on that commit and only then starts Bukit, with no secrets. A multilingual build needs the clean
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

  /** `config check`, then `doctor` (it finds content and template errors check does not; plan 8.2). */
  check(siteId: string, cwd: string, signal?: AbortSignal): Promise<CheckResult> {
    return this.guarded(siteId, cwd, async (runner, { commit, removed }) => {
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

  /**
   * The check before applying a change set (plan 7.2), with the site lock held by the caller: like
   * bukit_check, but a refusal (no Bukit, the pre-build guard) is a failed check the user may override.
   */
  async checkForApply(siteId: string, cwd: string): Promise<ApplyCheck> {
    try {
      const { passed, steps } = await this.check(siteId, cwd);
      return {
        passed,
        problemCode: null,
        problem: null,
        steps: steps.map(({ command, passed, exitCode, output }) => ({ command, passed, exitCode, output })),
      };
    } catch (err) {
      if (!(err instanceof AiBukitError)) throw err;
      return { passed: false, problemCode: err.code, problem: err.message, steps: [] };
    }
  }

  /** Build into a fresh .bukitjalil-build/ai-<id>/ and report; the output is deleted (previews come in M4). */
  build(siteId: string, cwd: string, signal?: AbortSignal): Promise<BuildResult> {
    return this.guarded(siteId, cwd, async (runner, { commit, removed }) => {
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

  // --- internals ---

  /** Snapshot and guard, then run `fn` with a runner; any refusal is an AiBukitError. */
  private guarded<T>(
    siteId: string,
    cwd: string,
    fn: (runner: BukitRunner, snapshot: Snapshot) => Promise<T>,
  ): Promise<T> {
    const call = this.guardedCall(siteId, cwd, fn);
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
    fn: (runner: BukitRunner, snapshot: Snapshot) => Promise<T>,
  ): Promise<T> {
    const site = this.opts.sites.get(siteId);
    if (site.readOnly) throw new AiBukitError("read_only", "The site is read-only, so Bukit cannot run on it.");
    const runner = await this.runner();
    const snapshot = await this.opts.changes.snapshot(siteId, cwd);
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
    return fn(runner, snapshot);
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
