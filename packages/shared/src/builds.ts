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

export interface BuildReport {
  /** Warning and error lines from Bukit's JSON log, in order. */
  messages: BuildMessage[];
  /** End of Bukit's stderr and of any stdout that was not a JSON log line. */
  output: string;
  reasons?: SiteReason[];
  detail?: string;
  /** A disk write failure behind the failed build (plan M5 layer 2). */
  problem?: "fs.disk_full" | "fs.read_only" | "fs.permission_denied";
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
