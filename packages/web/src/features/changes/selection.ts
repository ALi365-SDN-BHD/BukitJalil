import type { ApplySelection, ChangeView } from "@bukitjalil/shared";
import { useSyncExternalStore } from "react";

/**
 * What the user picked to apply (plan 7.5), shared by the review card and the Changes panel. Everything is
 * selected by default; the store only remembers what was left out, for one fingerprint of one change set,
 * so a new snapshot (or the rest after a partial apply) starts with everything selected again.
 */
interface Left {
  /** `${changeId}:${baseCommit}:${treeHash}` the choices belong to. */
  key: string;
  /** Files left out as a whole. */
  files: Set<string>;
  /** Hunk indexes left out, per file, with how many hunks that file's diff has. */
  hunks: Map<string, { skipped: Set<number>; total: number }>;
}

const EMPTY: Left = { key: "", files: new Set(), hunks: new Map() };
let left: Left = EMPTY;
const listeners = new Set<() => void>();

/**
 * The review the choices belong to. After a partial apply the rest keeps its tree but gets a new base, and
 * its hunks are numbered anew, so the base is part of it.
 */
export const reviewKey = (change: Pick<ChangeView, "id" | "baseCommit" | "treeHash">) =>
  `${change.id}:${change.baseCommit}:${change.treeHash}`;

function update(change: Pick<ChangeView, "id" | "baseCommit" | "treeHash">, fn: (next: Left) => void): void {
  const key = reviewKey(change);
  const next: Left =
    left.key === key
      ? {
          key,
          files: new Set(left.files),
          hunks: new Map([...left.hunks].map(([p, h]) => [p, { skipped: new Set(h.skipped), total: h.total }])),
        }
      : { key, files: new Set(), hunks: new Map() };
  fn(next);
  left = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * The hunk headers of a unified diff, in order: the server numbers hunks the same way. Content lines
 * start with " ", "+", "-" or "\", so only a header starts with "@@ -".
 */
export const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

/** The selection for `change` (null while there is none: everything is selected, nothing can change). */
export function useSelection(change: ChangeView | null) {
  const state = useSyncExternalStore(subscribe, () => left);
  const current = change && state.key === reviewKey(change) ? state : EMPTY;
  const fileOn = (path: string) => !current.files.has(path);
  const hunkOn = (path: string, index: number) => fileOn(path) && !current.hunks.get(path)?.skipped.has(index);
  const partial = current.files.size > 0 || current.hunks.size > 0;
  // Choices made on an earlier version of this change set (a new snapshot came in): they no longer apply.
  const dropped =
    !!change &&
    state.key.startsWith(`${change.id}:`) &&
    state.key !== reviewKey(change) &&
    (state.files.size > 0 || state.hunks.size > 0);
  return {
    fileOn,
    hunkOn,
    /** Some file or hunk is left out. */
    partial,
    /** Files or hunks were left out on an earlier version of the change set; everything is selected now. */
    dropped,
    setFile(path: string, on: boolean) {
      if (!change) return;
      update(change, (next) => {
        if (on) {
          next.files.delete(path);
          next.hunks.delete(path);
        } else next.files.add(path);
      });
    },
    /** `total`: how many hunks the file has; leaving all of them out leaves the file out. */
    setHunk(path: string, index: number, on: boolean, total: number) {
      if (!change) return;
      update(change, (next) => {
        // A file left out has all its hunks off: ticking one takes only that one.
        const skipped = next.files.has(path)
          ? new Set([...Array(total).keys()].filter((i) => i !== index || !on))
          : new Set(next.hunks.get(path)?.skipped);
        if (on) {
          skipped.delete(index);
          next.files.delete(path);
        } else skipped.add(index);
        if (skipped.size >= total) {
          next.files.add(path);
          next.hunks.delete(path);
        } else if (skipped.size === 0) next.hunks.delete(path);
        else next.hunks.set(path, { skipped, total });
      });
    },
    /** The request's `selection`: undefined for everything, else the files that are on, with their hunks. */
    request(): ApplySelection[] | undefined {
      if (!partial || !change) return undefined;
      const out: ApplySelection[] = [];
      for (const f of change.files) {
        if (current.files.has(f.path)) continue;
        const h = current.hunks.get(f.path);
        if (!h) out.push({ path: f.path });
        else out.push({ path: f.path, hunks: [...Array(h.total).keys()].filter((i) => !h.skipped.has(i)) });
      }
      return out;
    },
  };
}

/** Forget all choices (after applying: what is left starts with everything selected). */
export function clearSelection(): void {
  left = EMPTY;
  for (const listener of listeners) listener();
}

/** Whether the user may pick parts of this change set (plan 7.5). */
export const canPick = (change: ChangeView) => change.reviewable && !change.restoreOf && !change.filesTruncated;
