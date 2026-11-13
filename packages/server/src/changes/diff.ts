import type { ChangedFile, ChangedFileStatus, FileDiff } from "@bukitjalil/shared";
import { GitError, type GitRunner } from "../git/run.ts";

/** Files listed per change set; more are cut off and flagged (plan 7.2: the list is paged). */
export const MAX_FILES = 2000;
/** One file's diff larger than this is not shown. */
export const MAX_PATCH_BYTES = 1024 * 1024;
/**
 * Diffs never run external drivers or text conversion (plan 7.3), and list a rename as delete + add. The
 * hunk layout is pinned, whatever the repository config says, because a partial apply names hunks by their
 * index in the diff the review showed (plan 7.5).
 */
const DIFF = [
  "diff",
  "--no-ext-diff",
  "--no-textconv",
  "--no-renames",
  "--no-color",
  "--unified=3",
  "--inter-hunk-context=0",
  "--diff-algorithm=myers",
  "--indent-heuristic",
];

const STATUS: Record<string, ChangedFileStatus> = { A: "added", M: "modified", D: "deleted", T: "type_changed" };

/**
 * Bytes of each git listing read; the rest is drained and dropped, so a huge change lists its first files
 * (flagged as truncated) instead of failing.
 */
const MAX_LIST_BYTES = 4 * 1024 * 1024;

/**
 * The files that differ between two commits, by path, with line counts (null for binary files). With
 * `path`, only that file is looked at (it is passed literally, never as a pattern).
 */
export async function changedFiles(
  git: GitRunner,
  cwd: string,
  base: string,
  head: string,
  opts: { path?: string } = {},
): Promise<{ files: ChangedFile[]; truncated: boolean }> {
  if (base === head) return { files: [], truncated: false };
  const args = ["--end-of-options", base, head, ...(opts.path === undefined ? [] : ["--", `:(literal)${opts.path}`])];
  const read = (format: string) =>
    git.run([...DIFF, "-z", format, ...args], { cwd, headBytes: MAX_LIST_BYTES }).then((r) => r.stdout);
  const [nameOut, countOut] = await Promise.all([read("--name-status"), read("--numstat")]);
  const cut = nameOut.length >= MAX_LIST_BYTES;
  // Each record ends in NUL; whatever follows the last one is empty, or a partial record of a cut listing.
  const records = (buf: Buffer) => buf.toString("utf8").split("\0").slice(0, -1);
  const lines = new Map<string, { additions: number | null; deletions: number | null }>();
  // --numstat -z: "<added>\t<deleted>\t<path>\0"; binary files have "-" for both.
  for (const rec of records(countOut)) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(rec);
    if (!m?.[3]) continue;
    lines.set(m[3], {
      additions: m[1] === "-" ? null : Number(m[1]),
      deletions: m[2] === "-" ? null : Number(m[2]),
    });
  }
  // --name-status -z: "<status>\0<path>\0" pairs.
  const parts = records(nameOut);
  const files: ChangedFile[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i] ?? "";
    const p = parts[i + 1] ?? "";
    if (!p) continue;
    const n = lines.get(p);
    files.push({
      path: p,
      status: STATUS[code[0] ?? ""] ?? "modified",
      additions: n?.additions ?? null,
      deletions: n?.deletions ?? null,
      binary: n !== undefined && n.additions === null && n.deletions === null,
    });
  }
  return { files: files.slice(0, MAX_FILES), truncated: cut || files.length > MAX_FILES };
}

/** One file's unified diff between two commits; `file` must be one of the changed paths. */
export async function fileDiff(
  git: GitRunner,
  cwd: string,
  base: string,
  head: string,
  file: ChangedFile,
): Promise<FileDiff> {
  if (file.binary) return { path: file.path, binary: true, patch: null, tooLarge: false };
  try {
    const patch = await git.text([...DIFF, "--end-of-options", base, head, "--", `:(literal)${file.path}`], {
      cwd,
      maxOutputBytes: MAX_PATCH_BYTES,
    });
    return { path: file.path, binary: false, patch, tooLarge: false };
  } catch (err) {
    if (err instanceof GitError && err.kind === "output_too_large") {
      return { path: file.path, binary: false, patch: null, tooLarge: true };
    }
    throw err;
  }
}
