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
