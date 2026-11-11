import { z } from "zod";
import { TreePath } from "./panels.ts";
import type { SiteReason } from "./sites.ts";

/** Change sets (plan 7.2): what the AI changed in its working copy, waiting for review. */

export type ChangeStatus = "open" | "applied" | "rejected" | "stale";

export type ChangedFileStatus = "added" | "modified" | "deleted" | "type_changed";

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  /** Line counts; null for binary files. */
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export interface ChangeSet {
  id: string;
  siteId: string;
  status: ChangeStatus;
  /** The default-branch commit the change is based on. */
  baseCommit: string;
  /** The latest snapshot of the AI working copy (equal to baseCommit before the first snapshot). */
  snapshotCommit: string;
  /** Review fingerprint: the snapshot's tree. Applying must send it back unchanged. */
  treeHash: string;
  /** The AI's description from summarize_changes, if any. */
  summary: string | null;
  /** Sessions that took part, oldest first. */
  sessionIds: string[];
  createdAt: string;
  resolvedAt: string | null;
  resultCommit: string | null;
  /** A restore (plan 7.4): the default-branch commit whose content it brings back; null for AI changes. */
  restoreOf: string | null;
}

/** A change set with its file list, as the review shows it. */
export interface ChangeView extends ChangeSet {
  files: ChangedFile[];
  /** More files changed than the list holds. */
  filesTruncated: boolean;
  /** Open, no session running, and the snapshot differs from the base: it can be reviewed and applied. */
  reviewable: boolean;
}

export interface FileDiff {
  path: string;
  binary: boolean;
  /** The unified diff of this file; null when binary or too large. */
  patch: string | null;
  tooLarge: boolean;
}

/** The check run before applying (plan 7.2): Bukit `config check` and `doctor` on the snapshot. */
export type ApplyProblem = "bukit_missing" | "guard" | "notion" | "read_only";

export interface ApplyCheck {
  passed: boolean;
  /**
   * Why the check could not run, else null: `bukit_missing` (no usable Bukit), `guard` (the pre-build
   * safety check refused the snapshot) or `notion` (a Notion source cannot be checked without its token).
   */
  problemCode: ApplyProblem | null;
  /** The same, in words. */
  problem: string | null;
  steps: { command: string; passed: boolean; exitCode: number; output: string }[];
}

/**
 * What applying did: `applied` (merged into the default branch); `rebased` (the default branch had moved:
 * the change was merged onto it and must be reviewed again); `stale` (that merge had conflicts: the change
 * set is closed, the AI has to redo it); `check_failed` (nothing applied; send `force` to apply anyway).
 */
export type ApplyOutcome = "applied" | "rebased" | "stale" | "check_failed";

/** A full tree or commit id (SHA-1 or SHA-256). */
export const ObjectId = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);

/** POST /api/changes/:changeId/apply. */
export const ApplyRequest = z
  .object({
    /** The review fingerprint the user saw (ChangeSet.treeHash). */
    treeHash: ObjectId,
    /** Apply although the check failed. */
    force: z.boolean().optional(),
  })
  .strict();
export type ApplyRequest = z.infer<typeof ApplyRequest>;

/** GET /api/changes/:changeId/diff?path= */
export const ChangeDiffQuery = z.object({ path: TreePath.refine((p) => p !== "", { message: "must name a file" }) });

/** GET /api/sites/:siteId/changes/current, and the `change` event: the site's open change set, or null. */
export interface CurrentChange {
  change: ChangeView | null;
}

export interface ApplyResult {
  outcome: ApplyOutcome;
  change: ChangeSet;
  check: ApplyCheck | null;
}

/** One version of the site: a commit on the default branch, newest first (plan 7.4). */
export interface HistoryEntry {
  commit: string;
  parents: string[];
  subject: string;
  /** The rest of the message, without BukitJalil's trailer lines. */
  body: string;
  authorName: string;
  authorEmail: string;
  /** Author date, ISO 8601. */
  date: string;
  /** Files changed against the first parent (everything, for the first commit). */
  filesChanged: number;
  /** Sessions the change came from (BukitJalil-Sessions trailer). */
  sessionIds: string[];
  /** The version it restored (BukitJalil-Restore trailer). */
  restoreOf: string | null;
  /** Made with BukitJalil AI (its fixed author). */
  byAi: boolean;
}

export interface HistoryResponse {
  entries: HistoryEntry[];
  hasMore: boolean;
}

/** GET /api/sites/:siteId/history?skip= */
export const HistoryQuery = z.object({ skip: z.coerce.number().int().min(0).max(1_000_000).default(0) });

/** GET /api/sites/:siteId/history/:commit/diff (without `path`): what that version changed. */
export interface VersionDiff {
  entry: HistoryEntry;
  files: ChangedFile[];
  filesTruncated: boolean;
}

/** `path`: one file's diff in that version (a FileDiff) instead of the file list. */
export const VersionDiffQuery = z.object({
  path: TreePath.refine((p) => p !== "", { message: "must name a file" }).optional(),
});

/** POST /api/sites/:siteId/history/:commit/restore: the restore change set, and what the guard says. */
export interface RestoreResult {
  change: ChangeSet;
  /** The pre-build safety check on that version (plan 8.5); applying is still allowed, building is not. */
  guard: { ok: boolean; reasons: SiteReason[] };
}
