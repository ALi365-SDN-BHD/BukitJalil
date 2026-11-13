import { z } from "zod";
import type { NotionProblem } from "./data-sources.ts";
import { PanelRef } from "./panels.ts";
import type { SiteReason } from "./sites.ts";

/** Builds and previews (plan 8.3, 8.4, 9.1). */

export const BuildRequest = z.object({ ref: PanelRef.default("main") }).strict();
export const PreviewRequest = z.object({ ref: PanelRef.default("main") }).strict();

export type BuildStatus = "running" | "succeeded" | "failed";

/**
 * Why a build ended as it did. ok / config_or_content_error / render_error / stopped / failed come from
 * Bukit's exit code (plan 8.2); the rest are BukitJalil's own reasons for not building or not keeping it.
 */
export type BuildOutcome =
  | "ok"
  | "config_or_content_error"
  | "render_error"
  | "stopped"
  | "failed"
  /** The pre-build guard refused the commit (plan 8.5); `report.reasons` says why. */
  | "refused"
  /** The site uses a Notion source, which needs a token (plan 5.1); not available yet. */
  | "notion"
  /** site.baseUrl is not a path the preview can be served under (plan 16 #8); `report.detail` says why. */
  | "base_url"
  /** The output contained a symbolic link (plan 8.4). */
  | "symlink"
  /** The server stopped while the build was running. */
  | "interrupted"
  /** BukitJalil could not run the build (git, file system); `report.detail` says why. */
  | "error";

export interface BuildMessage {
  level: string;
  msg: string;
}

/** One kind of SEO issue in a build (plan M4 layer 7): Bukit's code, how often, and a few pages. */
export interface AuditIssueGroup {
  code: string;
  severity: "error" | "warning" | "info";
  count: number;
  /** Bukit's text for the first occurrence (English, as Bukit writes it). */
  message: string;
  /** Up to AUDIT_ROUTES_PER_GROUP pages; "" stands for the site as a whole. */
  routes: string[];
  /** More pages have this issue than `routes` lists; missing in reports saved before it existed. */
  moreRoutes?: boolean;
}

/**
 * Summary of the SEO and GEO reports Bukit writes with every build (`.bukit/seo-report.json`,
 * `.bukit/geo-report.json`; the same data `bukit seo audit` / `bukit geo audit` read).
 */
export interface BuildAudit {
  seo: {
    routes: number;
    errors: number;
    warnings: number;
    /** site.yaml has no site.url: canonical links, images and structured data cannot be absolute. */
    siteUrlMissing: boolean;
    /** Warnings that only exist because site.url is missing (folded into one hint), counted. */
    siteUrlWarnings: number;
    /** The other issues, errors first, most frequent first. */
    groups: AuditIssueGroup[];
    /** More kinds of issues than `groups` holds. */
    groupsTruncated: boolean;
  } | null;
  geo: {
    /** 0–100. */
    score: number;
    llmsTxt: boolean;
    llmsFullTxt: boolean;
    /** Pages with GEO front matter (geo.faq, geo.steps, geo.schema_type). */
    enhancedRoutes: number;
  } | null;
}

export const AUDIT_ROUTES_PER_GROUP = 5;
export const AUDIT_MAX_GROUPS = 40;

/** The SEO / GEO report panel (plan 10.4). */
export const AuditQuery = z.object({ ref: PanelRef.default("main") }).strict();

/** One SEO issue from a build's full report. */
export interface AuditIssue {
  severity: AuditIssueGroup["severity"];
  code: string;
  /** "" stands for the site as a whole. */
  route: string;
  message: string;
}

/** "unknown": the previous summary was cut short and does not list this kind. */
export type AuditChange = "new" | "fixed" | "more" | "fewer" | "same" | "unknown";

/** One kind of issue (severity + code) compared with the previous report. */
export interface AuditCompareGroup {
  code: string;
  severity: AuditIssueGroup["severity"];
  count: number;
  /** Null when unknown (see `change`). */
  previous: number | null;
  change: AuditChange;
}

export interface AuditCompare {
  groups: AuditCompareGroup[];
  /** The previous summary held only some kinds of issues: a kind it does not list may not be new. */
  previousTruncated: boolean;
  /** Null when either report has no SEO part. */
  errors: number | null;
  warnings: number | null;
  /** Null when either report has no GEO score. */
  geoScore: number | null;
}

export interface AuditBuildRef {
  buildId: string;
  commit: string;
  finishedAt: string | null;
}

export interface AuditReportResponse {
  ref: PanelRef;
  build: AuditBuildRef;
  /** The summary saved with the build (the one build details show). */
  summary: BuildAudit;
  /** Every issue, read again from the kept output; null when the output is gone or unreadable. */
  issues: AuditIssue[] | null;
  issuesTruncated: boolean;
  /** A newer build of the same version ended without a report (it failed), so this report may be out of date. */
  stale: boolean;
  /** For main: the previous main build with a report; for change: the newest main build with one. */
  previous: (AuditBuildRef & { summary: BuildAudit }) | null;
  compare: AuditCompare | null;
}

export const AUDIT_MAX_ISSUES = 5000;

export interface BuildReport {
  /** Warning and error lines from Bukit's JSON log, in order. */
  messages: BuildMessage[];
  /** End of Bukit's stderr and of any stdout that was not a JSON log line. */
  output: string;
  reasons?: SiteReason[];
  detail?: string;
  /** A disk write failure behind the failed build (plan M5 layer 2). */
  problem?: "fs.disk_full" | "fs.read_only" | "fs.permission_denied";
  /** A Notion failure recognised in Bukit's output (plan 5.4). */
  notionProblem?: NotionProblem;
  /** SEO / GEO summary of a successful build (plan M4 layer 7); absent when Bukit wrote no reports. */
  audit?: BuildAudit;
  /**
   * Where the preview opens when the output has no index.html at its root (a multilingual Bukit site writes
   * each language under /<lang>/): the default language's home, such as "/zh-CN/".
   */
  entry?: string;
  /** The path the preview is served under, site.baseUrl such as "/blog/"; absent for "/" (plan 16 #8). */
  basePath?: string;
}

export interface Build {
  id: string;
  siteId: string;
  ref: PanelRef;
  commit: string;
  status: BuildStatus;
  outcome: BuildOutcome | null;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  /** The output is kept and can be previewed. */
  hasOutput: boolean;
  /** Set once the build ended; always null in the list (GET /builds/:buildId has it). */
  report: BuildReport | null;
}

export interface BuildListResponse {
  builds: Build[];
}

export interface PreviewResponse {
  ref: PanelRef;
  /** http://127.0.0.1:<port>/, the address to put in the iframe. */
  url: string;
  port: number;
  buildId: string;
  commit: string;
}
