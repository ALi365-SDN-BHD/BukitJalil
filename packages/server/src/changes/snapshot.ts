import fs from "node:fs";
import path from "node:path";
import { segmentKey } from "../agent/gate.ts";
import type { GitRunner } from "../git/run.ts";
import { BUILD_DIRS } from "../sites/exclude.ts";

/** Committer of snapshot commits; they stay inside BukitJalil (the applied commit gets the user's identity). */
export const SNAPSHOT_IDENTITY = { "user.name": "BukitJalil", "user.email": "ai@bukitjalil.invalid" };
const SNAPSHOT_MESSAGE = "BukitJalil AI snapshot";
/** Ignored files may stay here: build output and caches the AI cannot write (plan 6.3). */
const IGNORED_OK = new Set<string>([...BUILD_DIRS, "node_modules"]);

/**
 * Pathspecs that keep a top-level name out of `git add`, even when .gitignore un-ignores it. The first
 * character is a bracket class: git refuses a pathspec that literally names an ignored path, and a
 * glob without a leading `**` only matches at the top level.
 */
const excludeTopLevel = (name: string) => {
  const glob = `[${name[0]}]${name.slice(1)}`;
  return [`:(exclude,icase,glob)${glob}`, `:(exclude,icase,glob)${glob}/**`];
};

export interface Snapshot {
  commit: string;
  /** Ignored files deleted before the commit (relative paths; a directory ends in "/"). */
  removed: string[];
}

/**
 * Commit a checkout as it is now (plan 7.2): `add -A`, `write-tree`, `commit-tree` on HEAD, HEAD moves to
 * it; with nothing changed, HEAD stays. Files ignored by .gitignore cannot be committed, so the guard would
 * never see them while Bukit reads them: they are deleted first (outside the build directories) and listed
 * in `removed`, leaving the checkout equal to the snapshot. Build directories stay out of the commit even
 * when a .gitignore rule un-ignores them.
 */
export async function snapshotCheckout(git: GitRunner, cwd: string): Promise<Snapshot> {
  const removed = (
    await git.text(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], { cwd })
  )
    .split("\0")
    .filter((p) => p !== "" && !IGNORED_OK.has(segmentKey(p.split("/")[0] ?? "")));
  for (const rel of removed) {
    const abs = path.resolve(cwd, rel);
    if (!abs.startsWith(cwd + path.sep)) throw new Error(`git listed a path outside the checkout: ${rel}`);
    fs.rmSync(abs, { recursive: true, force: true });
  }
  await git.run(["add", "-A", "--", ".", ...[...IGNORED_OK].flatMap(excludeTopLevel)], { cwd });
  const tree = (await git.text(["write-tree"], { cwd })).trim();
  const head = (await git.text(["rev-parse", "--verify", "HEAD"], { cwd })).trim();
  const headTree = (await git.text(["rev-parse", "--verify", "HEAD^{tree}"], { cwd })).trim();
  if (tree === headTree) return { commit: head, removed };
  const commit = (
    await git.text(["commit-tree", tree, "-p", head, "-m", SNAPSHOT_MESSAGE], { cwd, config: SNAPSHOT_IDENTITY })
  ).trim();
  await git.run(["update-ref", "--no-deref", "HEAD", commit, head], { cwd });
  return { commit, removed };
}
