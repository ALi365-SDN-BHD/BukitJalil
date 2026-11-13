import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ApplySelection } from "@bukitjalil/shared";
import { GitError, type GitRunner } from "../git/run.ts";
import { SiteError } from "../sites/location.ts";
import { fileDiff } from "./diff.ts";

/** One changed path between two commits, as `git diff --raw` lists it (modes "000000" when absent). */
export interface RawChange {
  path: string;
  oldMode: string;
  newMode: string;
  oldOid: string;
  newOid: string;
}

/** Same hardening as the review diffs (plan 7.3): no external drivers, no text conversion, no renames. */
const RAW = ["diff", "--raw", "-z", "--no-renames", "--no-abbrev", "--no-ext-diff", "--no-textconv"];

/** Every path that differs between `base` and `head`, by path. */
export async function rawChanges(
  git: GitRunner,
  cwd: string,
  base: string,
  head: string,
  path?: string,
): Promise<Map<string, RawChange>> {
  const only = path === undefined ? [] : ["--", `:(literal)${path}`];
  const out = (await git.run([...RAW, "--end-of-options", base, head, ...only], { cwd })).stdout.toString("utf8");
  // ":<old mode> <new mode> <old oid> <new oid> <status>\0<path>\0" per path.
  const parts = out.split("\0");
  const changes = new Map<string, RawChange>();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const m = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) [A-Z]\d*$/.exec(parts[i] ?? "");
    const p = parts[i + 1];
    if (!m || !p) continue;
    changes.set(p, {
      path: p,
      oldMode: m[1] as string,
      newMode: m[2] as string,
      oldOid: m[3] as string,
      newOid: m[4] as string,
    });
  }
  return changes;
}

/**
 * The tree of `base` with only the selected changes of `snapshot` (plan 7.5): each listed file as it is in
 * the snapshot. Built in a temporary index file under `tmpDir`, so no checkout or index is touched.
 * Throws `change.file_not_found` for a path that did not change.
 */
export async function selectedTree(
  git: GitRunner,
  opts: { cwd: string; base: string; snapshot: string; selection: readonly ApplySelection[]; tmpDir: string },
): Promise<string> {
  const changes = await rawChanges(git, opts.cwd, opts.base, opts.snapshot);
  const lines: string[] = [];
  for (const item of opts.selection) {
    const change = changes.get(item.path);
    if (!change) throw new SiteError("change.file_not_found", 404);
    if (item.hunks !== undefined) {
      const oid = await partialBlob(git, opts.cwd, opts.base, opts.snapshot, change, item.hunks);
      lines.push(`${change.newMode} ${oid}\t${change.path}\0`);
      continue;
    }
    // Mode 0 removes the path from the index (`update-index --index-info`).
    const removed = change.newMode === "000000";
    lines.push(
      `${removed ? "0" : change.newMode} ${removed ? change.oldOid.replace(/./g, "0") : change.newOid}\t${change.path}\0`,
    );
  }

  fs.mkdirSync(opts.tmpDir, { recursive: true, mode: 0o700 });
  const indexFile = path.join(opts.tmpDir, `partial-${crypto.randomBytes(8).toString("hex")}.index`);
  try {
    await git.run(["read-tree", "--end-of-options", opts.base], { cwd: opts.cwd, indexFile });
    await git.run(["update-index", "-z", "--index-info"], { cwd: opts.cwd, indexFile, input: lines.join("") });
    const tree = (await git.text(["write-tree"], { cwd: opts.cwd, indexFile })).trim();
    // The index replaces a file with a folder of the same name (or the other way round) on its own, so
    // selecting one side of such a swap would take the other side too: only selected paths may differ.
    const selected = new Set(opts.selection.map((item) => item.path));
    for (const p of (await rawChanges(git, opts.cwd, opts.base, tree)).keys()) {
      if (!selected.has(p)) throw new SiteError("change.partial_unsupported", 400, { path: p });
    }
    return tree;
  } finally {
    fs.rmSync(indexFile, { force: true });
    fs.rmSync(`${indexFile}.lock`, { force: true });
  }
}

/** A hunk's line ranges, 0-based: lines [oldStart, oldStart + oldCount) of the old file become the new ones. */
export interface HunkRange {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

/**
 * The hunks of a unified diff, in order, from their "@@ -a,b +c,d @@" headers. Content lines always start
 * with " ", "+", "-" or "\\", so only a header starts with "@@ -".
 */
export function parseHunks(patch: string): HunkRange[] {
  const hunks: HunkRange[] = [];
  for (const line of patch.split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const oldCount = m[2] === undefined ? 1 : Number(m[2]);
    const newCount = m[4] === undefined ? 1 : Number(m[4]);
    // An empty side names the line after which it is (0 for the start of the file).
    hunks.push({
      oldStart: oldCount === 0 ? Number(m[1]) : Number(m[1]) - 1,
      oldCount,
      newStart: newCount === 0 ? Number(m[3]) : Number(m[3]) - 1,
      newCount,
    });
  }
  return hunks;
}

/** Lines of a file, each with its "\n" (the last one may have none). */
function splitLines(data: Buffer): Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;
  for (let i = data.indexOf(10); i !== -1; i = data.indexOf(10, i + 1)) {
    lines.push(data.subarray(start, i + 1));
    start = i + 1;
  }
  if (start < data.length) lines.push(data.subarray(start));
  return lines;
}

/**
 * `before` with the selected hunks taken from `after` (plan 7.5): in bytes, by the hunks' line ranges, so
 * files without a final newline or in any encoding come out exact. Null when the ranges do not fit.
 */
export function applyHunks(
  before: Buffer,
  after: Buffer,
  hunks: readonly HunkRange[],
  selected: ReadonlySet<number>,
): Buffer | null {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const out: Buffer[] = [];
  let pos = 0;
  for (const [i, h] of hunks.entries()) {
    if (h.oldStart < pos || h.oldStart + h.oldCount > oldLines.length || h.newStart + h.newCount > newLines.length) {
      return null;
    }
    if (!selected.has(i)) continue;
    out.push(...oldLines.slice(pos, h.oldStart), ...newLines.slice(h.newStart, h.newStart + h.newCount));
    pos = h.oldStart + h.oldCount;
  }
  out.push(...oldLines.slice(pos));
  return Buffer.concat(out);
}

const REGULAR = new Set(["100644", "100755"]);
/** Largest file split into hunks; larger ones are applied as a whole. */
const MAX_PARTIAL_BYTES = 16 * 1024 * 1024;

/** A file whose change can be split by hunk: its hunks and both versions' bytes. */
interface HunkPlan {
  hunks: HunkRange[];
  before: Buffer;
  after: Buffer;
}

/**
 * How a file's change splits into hunks (plan 7.5), or null when it can only be applied as a whole: only a
 * regular file whose content changed and whose mode did not, with a diff the review can show, and only if
 * all its hunks together give exactly the new file.
 */
export async function hunkPlan(
  git: GitRunner,
  cwd: string,
  base: string,
  head: string,
  change: RawChange,
): Promise<HunkPlan | null> {
  if (change.oldMode !== change.newMode || !REGULAR.has(change.newMode)) return null;
  const diff = await fileDiff(git, cwd, base, head, {
    path: change.path,
    status: "modified",
    additions: null,
    deletions: null,
    binary: false,
  });
  if (diff.patch === null || /^Binary files /m.test(diff.patch)) return null;
  const hunks = parseHunks(diff.patch);
  if (hunks.length === 0) return null;
  const read = async (oid: string) => {
    try {
      return (await git.run(["cat-file", "blob", oid], { cwd, maxOutputBytes: MAX_PARTIAL_BYTES })).stdout;
    } catch (err) {
      if (err instanceof GitError && err.kind === "output_too_large") return null;
      throw err;
    }
  };
  const [before, after] = await Promise.all([read(change.oldOid), read(change.newOid)]);
  if (!before || !after) return null;
  const whole = applyHunks(before, after, hunks, new Set(hunks.keys()));
  return whole?.equals(after) ? { hunks, before, after } : null;
}

/**
 * The blob of a file with only some hunks of its change (plan 7.5), written to the object store.
 * `change.partial_unsupported` when the file cannot be split (hunkPlan); an index past its hunks means the
 * selection was made on another diff: `change.fingerprint_mismatch`.
 */
async function partialBlob(
  git: GitRunner,
  cwd: string,
  base: string,
  head: string,
  change: RawChange,
  indexes: readonly number[],
): Promise<string> {
  const plan = await hunkPlan(git, cwd, base, head, change);
  if (!plan) throw new SiteError("change.partial_unsupported", 400, { path: change.path });
  if (indexes.some((i) => i >= plan.hunks.length)) throw new SiteError("change.fingerprint_mismatch", 409);
  const selected = new Set(indexes);
  if (selected.size === plan.hunks.length) return change.newOid;
  const content = applyHunks(plan.before, plan.after, plan.hunks, selected);
  if (content === null) throw new SiteError("change.partial_unsupported", 400, { path: change.path });
  return (await git.text(["hash-object", "-w", "--no-filters", "--stdin"], { cwd, input: content })).trim();
}
