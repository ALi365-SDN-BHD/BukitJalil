import { z } from "zod";
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

export interface BuildReport {
  /** Warning and error lines from Bukit's JSON log, in order. */
  messages: BuildMessage[];
  /** End of Bukit's stderr and of any stdout that was not a JSON log line. */
  output: string;
  reasons?: SiteReason[];
  detail?: string;
  /** A disk write failure behind the failed build (plan M5 layer 2). */
  problem?: "fs.disk_full" | "fs.read_only" | "fs.permission_denied";
  /** SEO / GEO summary of a successful build (plan M4 layer 7); absent when Bukit wrote no reports. */
  audit?: BuildAudit;
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
