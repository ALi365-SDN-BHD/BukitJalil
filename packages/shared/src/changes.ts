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

export interface ApplyRequest {
  /** The review fingerprint the user saw (ChangeSet.treeHash). */
  treeHash: string;
  /** Apply although the check failed. */
  force?: boolean;
}

export interface ApplyResult {
  outcome: ApplyOutcome;
  change: ChangeSet;
  check: ApplyCheck | null;
}
