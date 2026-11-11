import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  Deploy,
  DeployOutcome,
  DeployReport,
  DeployStatusResponse,
  DeployStep,
  DeployStepResult,
  DeployTarget,
  Site,
} from "@bukitjalil/shared";
import { readPublishAudit } from "../builds/audit.ts";
import { buildReport, checkoutLanguage, findSymlink, previewEntry } from "../builds/service.ts";
import { guardCommit, isRecord } from "../bukit/guard.ts";
import type { BukitService } from "../bukit/locate.ts";
import {
  type BukitRunner,
  type BukitRunResult,
  checkPassed,
  DEPLOY_TOKEN_ENV,
  type DeployEnv,
  usableRunner,
} from "../bukit/runner.ts";
import { readBlobAt } from "../git/objects.ts";
import type { GitRunner } from "../git/run.ts";
import type { Logger } from "../log.ts";
import type { PanelService } from "../panels/service.ts";
import { parseYaml } from "../panels/yaml.ts";
import type { AppPaths } from "../paths.ts";
import type { SecretStore } from "../settings/secrets.ts";
import { SiteError } from "../sites/location.ts";
import type { SiteLocks } from "../sites/locks.ts";
import type { SiteService } from "../sites/service.ts";
import { storageErrorCode, storageErrorInText } from "../storage-errors.ts";
import { DeployStore, newDeployId } from "./store.ts";
import { deployTarget } from "./target.ts";

export interface DeployServiceOptions {
  sites: SiteService;
  panels: PanelService;
  secrets: SecretStore;
  git: GitRunner;
  bukit: BukitService;
  locks: SiteLocks;
  paths: AppPaths;
  logger: Logger;
  db: DatabaseSync;
}

/** Where the output to publish is built, inside the main checkout (Bukit wants a relative --output). */
export const DEPLOY_OUTPUT_PARENT = ".bukitjalil-deploy";
const LIST_LIMIT = 20;
const KEEP_RECORDS = 50;
const MAX_SITE_YAML = 1024 * 1024;

/** The report with every copy of `secret` replaced (a token shorter than 8 characters is not looked for). */
export function redact(report: DeployReport, secret: string): DeployReport {
  if (secret.length < 8) return report;
  const clean = (text: string) => text.split(secret).join("[token]");
  return {
    ...report,
    output: clean(report.output),
    messages: report.messages.map((m) => ({ ...m, msg: clean(m.msg) })),
    ...(report.detail ? { detail: clean(report.detail) } : {}),
  };
}

/**
 * A root page that sends visitors on to the language home page. Bukit's multilingual builds only write
 * /<lang>/, so without it the site's address would answer 404 on GitHub Pages. The link is relative, so it
 * also works for a project site served under /<repo>/; `entry` is a checked folder name (see previewEntry).
 */
export function rootRedirectPage(entry: string): string {
  const to = entry.replace(/^\//, "");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${to}">
<title>${to}</title>
</head>
<body><p><a href="${to}">${to}</a></p></body>
</html>
`;
}

/** A step's warning and error lines and the end of its text output, read as for builds. */
function logOf(result: BukitRunResult): Pick<DeployReport, "messages" | "output"> {
  const { messages, output } = buildReport(result);
  return { messages, output };
}

/**
 * Publishing to GitHub Pages (plan 14 M6). One publish per site at a time, under the site lock shared with
 * builds. Everything runs in the main checkout at the confirmed default-branch commit: the pre-build guard,
 * `config check`, `doctor`, a build into a new empty folder, `publish audit` of that folder, then
 * `deploy --skip-build` of exactly that folder. Only the last step gets the token and the commit identity.
 */
export class DeployService {
  readonly store: DeployStore;
  private readonly running = new Map<string, { promise: Promise<void>; abort: AbortController }>();
  private readonly listeners = new Set<(deploy: Deploy) => void>();
  private closing = false;

  constructor(private readonly opts: DeployServiceOptions) {
    this.store = new DeployStore(opts.db);
    const interrupted = this.store.closeInterrupted();
    if (interrupted > 0) opts.logger.log("warn", "deploy.interrupted", { count: interrupted });
  }

  /** Listen to publish starts, steps and ends (for the event stream). */
  onEvent(listener: (deploy: Deploy) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The target in site.yaml on the default branch, and whether a publish can start. */
  async status(siteId: string): Promise<DeployStatusResponse> {
    const site = this.opts.sites.get(siteId);
    const { commit, config } = await this.opts.panels.config(siteId, "main");
    const target = this.sourceBranchTarget(site, deployTarget(isRecord(config) ? config : null));
    const token = this.opts.secrets.get("github") !== null;
    return { commit, target, token, ready: target.problem === null && token && site.readOnly === null };
  }

  list(siteId: string): Deploy[] {
    this.opts.sites.get(siteId);
    return this.store.list(siteId, LIST_LIMIT).map((d) => ({ ...d, report: null }));
  }

  get(siteId: string, deployId: string): Deploy {
    this.opts.sites.get(siteId);
    const deploy = this.store.get(deployId);
    if (!deploy || deploy.siteId !== siteId) throw new SiteError("deploy.not_found", 404);
    return deploy;
  }

  /**
   * Start publishing `commit`, which must still be the head of the default branch (the user confirmed it),
   * and return the record as running; it finishes in the background.
   */
  async start(siteId: string, commit: string): Promise<Deploy> {
    this.assertOpen();
    const site = this.opts.sites.get(siteId);
    if (site.readOnly) throw new SiteError("site.read_only", 409);
    const identity = this.opts.sites.commitIdentity();
    const token = this.opts.secrets.get("github");
    if (!token) throw new SiteError("deploy.no_token", 409);
    const runner = await usableRunner(this.opts.bukit, this.runnerOpts());
    if (!runner) throw new SiteError("build.bukit_missing", 409);

    const release = this.opts.locks.acquire(siteId, "deploy");
    try {
      // Under the lock: what is published is the head now, and it must be what the user confirmed.
      const head = await this.opts.sites.headOf(site);
      if (head !== commit) throw new SiteError("deploy.commit_changed", 409, { commit: head });
      const target = this.sourceBranchTarget(site, await this.targetAt(site, head));
      if (target.problem !== null || !target.repo) {
        throw new SiteError("deploy.no_target", 409, { problem: target.problem ?? "not_configured" });
      }
      this.assertOpen();
      const id = newDeployId();
      this.store.insert({ id, siteId, commit, repo: target.repo, branch: target.branch, url: target.url });
      const abort = new AbortController();
      const env: DeployEnv = { token, name: identity["user.name"], email: identity["user.email"] };
      const promise = this.execute(site, id, commit, target, runner, env, abort.signal)
        .catch((err) => this.opts.logger.log("error", "deploy.crashed", { id, error: String(err) }))
        .finally(() => {
          this.running.delete(id);
          release();
          try {
            this.emit(id);
          } catch (err) {
            this.opts.logger.log("error", "deploy.end_failed", { id, error: String(err) });
          }
          try {
            this.store.prune(siteId, KEEP_RECORDS);
          } catch (err) {
            this.opts.logger.log("error", "deploy.prune_failed", { id, error: String(err) });
          }
        });
      this.running.set(id, { promise, abort });
      this.emit(id);
      return this.store.get(id) as Deploy;
    } catch (err) {
      release();
      throw err;
    }
  }

  /** Stop a running publish (Bukit gets SIGINT). */
  stop(siteId: string, deployId: string): Deploy {
    const deploy = this.get(siteId, deployId);
    const run = this.running.get(deployId);
    if (!run) throw new SiteError("deploy.not_running", 409);
    run.abort.abort();
    return deploy;
  }

  async settled(): Promise<void> {
    await Promise.all([...this.running.values()].map((r) => r.promise));
  }

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

  private emit(id: string): void {
    const record = this.store.get(id);
    if (!record) return;
    const deploy = { ...record, report: null };
    for (const listener of this.listeners) {
      try {
        listener(deploy);
      } catch (err) {
        this.opts.logger.log("error", "deploy.listener_failed", { error: String(err) });
      }
    }
  }

  /** A publish branch equal to the source branch would overwrite the source; refuse it. */
  private sourceBranchTarget(site: Site, target: DeployTarget): DeployTarget {
    if (target.problem === null && target.branch === site.defaultBranch) return { ...target, problem: "source_branch" };
    return target;
  }

  /** The target in site.yaml at `commit` (what is about to be published, not what a panel last showed). */
  private async targetAt(site: Site, commit: string): Promise<DeployTarget> {
    const text = await readBlobAt(this.opts.git, site.path, commit, "site.yaml", MAX_SITE_YAML);
    if (!text) return deployTarget(null);
    const { value } = parseYaml(text.toString("utf8"));
    return deployTarget(isRecord(value) ? value : null);
  }

  private async execute(
    site: Site,
    id: string,
    commit: string,
    target: DeployTarget,
    runner: BukitRunner,
    env: DeployEnv,
    signal: AbortSignal,
  ): Promise<void> {
    const steps: DeployStepResult[] = [];
    const finish = (outcome: DeployOutcome, report: Partial<DeployReport> = {}) => {
      const status = outcome === "ok" ? "succeeded" : outcome === "stopped" ? "stopped" : "failed";
      // Nothing Bukit or its git printed may carry the token into app.db or the UI.
      const full = redact({ messages: [], output: "", ...report, steps }, env.token);
      this.store.finish(id, status, outcome, full);
    };
    const begin = (step: DeployStep) => {
      this.store.setStep(id, step);
      this.emit(id);
    };
    /** Run one Bukit step; on failure, the record ends with that step's messages. */
    const run = async (step: DeployStep, command: Parameters<BukitRunner["run"]>[0], args: string[]) => {
      begin(step);
      const result = await runner.run(command, args, {
        cwd: checkout,
        signal,
        ...(command === "deploy" ? { deploy: env } : {}),
      });
      const ok = checkPassed(result);
      steps.push({ step, ok, exitCode: result.exitCode, durationMs: result.durationMs });
      return { result, ok };
    };
    const failed = (result: BukitRunResult, extra: Partial<DeployReport> = {}) => {
      const report = logOf(result);
      const problem = storageErrorInText([report.output, ...report.messages.map((m) => m.msg)].join("\n"));
      finish(result.stopped === "aborted" ? "stopped" : "step_failed", {
        ...report,
        ...extra,
        ...(problem ? { problem } : {}),
      });
    };

    let checkout = "";
    let output: string | null = null;
    try {
      begin("guard");
      const started = Date.now();
      const guard = await guardCommit(this.opts.git, site.path, commit);
      steps.push({
        step: "guard",
        ok: guard.ok && !guard.usesNotion,
        exitCode: null,
        durationMs: Date.now() - started,
      });
      if (!guard.ok || guard.usesNotion) this.opts.sites.applyGuard(site.id, commit, guard);
      if (!guard.ok) return finish("refused", { reasons: guard.reasons });
      // Publishing a Notion site needs the Notion token in the build, which is not offered yet.
      if (guard.usesNotion) return finish("notion");
      if (signal.aborted) return finish("stopped");

      checkout = await this.opts.sites.mainCheckout(site.id, site.path, commit);
      const rel = `${DEPLOY_OUTPUT_PARENT}/${id}`;
      output = path.join(checkout, rel);
      fs.rmSync(path.join(checkout, DEPLOY_OUTPUT_PARENT), { recursive: true, force: true });

      const check = await run("check", "check", ["config", "check", "--config", "site.yaml"]);
      if (!check.ok) return failed(check.result);
      const doctor = await run("doctor", "doctor", ["doctor", "--config", "site.yaml"]);
      if (!doctor.ok) return failed(doctor.result);
      // The site's own baseUrl and site.url, unlike a preview build (served at "/").
      const build = await run("build", "build", [
        "build",
        "--config",
        "site.yaml",
        "--output",
        rel,
        "--log-format",
        "json",
      ]);
      if (!build.ok) return failed(build.result);
      if (!fs.lstatSync(output, { throwIfNoEntry: false })?.isDirectory()) {
        return finish("step_failed", { ...logOf(build.result), detail: "bukit wrote no output directory" });
      }
      const link = findSymlink(output);
      if (link) return finish("symlink", { detail: link });

      const audit = await run("audit", "publish", ["publish", "audit", "--dir", rel]);
      const summary = readPublishAudit(output);
      if (!audit.ok) return failed(audit.result, summary ? { audit: summary } : {});
      // After the audit, which checks the pages Bukit wrote, not this one.
      const entry = previewEntry(output, checkoutLanguage(checkout));
      if (entry) fs.writeFileSync(path.join(output, "index.html"), rootRedirectPage(entry), { flag: "wx" });

      const deploy = await run("deploy", "deploy", [
        "deploy",
        "--config",
        "site.yaml",
        "--skip-build",
        "--output",
        rel,
        "--repo",
        target.repo as string,
        "--branch",
        target.branch,
        "--token-env",
        DEPLOY_TOKEN_ENV,
      ]);
      if (!deploy.ok) return failed(deploy.result, summary ? { audit: summary } : {});
      finish("ok", { ...logOf(deploy.result), ...(summary ? { audit: summary } : {}) });
    } catch (err) {
      const problem = storageErrorCode(err) ?? undefined;
      finish("error", {
        detail: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        ...(problem ? { problem } : {}),
      });
    } finally {
      if (checkout) fs.rmSync(path.join(checkout, DEPLOY_OUTPUT_PARENT), { recursive: true, force: true });
    }
  }
}
