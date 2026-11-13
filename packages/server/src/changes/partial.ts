import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ApplySelection } from "@bukitjalil/shared";
import type { GitRunner } from "../git/run.ts";
import { SiteError } from "../sites/location.ts";

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
): Promise<Map<string, RawChange>> {
  const out = (await git.run([...RAW, "--end-of-options", base, head], { cwd })).stdout.toString("utf8");
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
    if (item.hunks !== undefined) throw new SiteError("change.partial_unsupported", 400);
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
