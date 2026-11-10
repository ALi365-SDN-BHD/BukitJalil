import { z } from "zod";
import type { BuildAudit } from "./builds.ts";
import type { SiteReason } from "./sites.ts";

/** Where a site is published (plan 14 M6): the `deploy` section of site.yaml on the default branch. */
export interface DeployTarget {
  /** owner/name; null when not set or not valid. */
  repo: string | null;
  branch: string;
  cname: string | null;
  /** Where GitHub Pages should serve the site, when it can be told. */
  url: string | null;
  /** Why the site cannot be published to this target yet. */
  problem: "no_config" | "not_configured" | "bad_provider" | "bad_repo" | "bad_branch" | "bad_cname" | null;
}

/** GET /api/sites/:id/deploy. */
export interface DeployStatusResponse {
  /** The default-branch commit the target was read from. */
  commit: string;
  target: DeployTarget;
  /** A GitHub token is set (plan 6.5). */
  token: boolean;
  /** Target valid, token set and the site not read-only. */
  ready: boolean;
}

/** Default branch of `bukit deploy` (2.0.12). */
export const DEFAULT_DEPLOY_BRANCH = "gh-pages";

/** The steps of a publish, in order (plan 14 M6). */
export const deploySteps = ["guard", "check", "doctor", "build", "audit", "deploy"] as const;
export type DeployStep = (typeof deploySteps)[number];

export type DeployStatus = "running" | "succeeded" | "failed" | "stopped";

export type DeployOutcome =
  | "ok"
  /** The pre-build guard refused the commit (plan 8.5). */
  | "refused"
  /** The site uses Notion, which BukitJalil cannot publish yet. */
  | "notion"
  /** A step failed: see `step`. */
  | "step_failed"
  /** The build wrote a symbolic link (plan 8.4). */
  | "symlink"
  | "stopped"
  | "interrupted"
  | "error";

export interface DeployStepResult {
  step: DeployStep;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
}

export interface DeployReport {
  steps: DeployStepResult[];
  /** Warning and error lines from Bukit, of the step that failed or of the deploy. */
  messages: { level: string; msg: string }[];
  /** End of Bukit's text output of that step. */
  output: string;
  /** Summary of `.bukit/publish-audit-report.json` of the published output. */
  audit?: BuildAudit["seo"];
  reasons?: SiteReason[];
  detail?: string;
  problem?: "fs.disk_full" | "fs.read_only" | "fs.permission_denied";
}

export interface Deploy {
  id: string;
  siteId: string;
  commit: string;
  repo: string;
  branch: string;
  /** Where GitHub Pages should serve the site. */
  url: string | null;
  status: DeployStatus;
  /** The step running now, or the one that failed. */
  step: DeployStep | null;
  outcome: DeployOutcome | null;
  startedAt: string;
  finishedAt: string | null;
  /** Set once it ended; always null in the list. */
  report: DeployReport | null;
}

export interface DeployListResponse {
  deploys: Deploy[];
}

/** POST /api/sites/:id/deploys: the default-branch commit the user confirmed. */
export const DeployRequest = z.object({ commit: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/) });
export type DeployRequest = z.infer<typeof DeployRequest>;
