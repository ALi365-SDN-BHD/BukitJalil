import { assertOid, GitError, type GitRunner } from "./run.ts";

/** One entry of `git ls-tree -l`. */
export interface TreeEntry {
  /** "100644", "100755", "120000" (symlink), "160000" (submodule), "040000" (tree, non-recursive only) */
  mode: string;
  type: "blob" | "tree" | "commit";
  oid: string;
  /** Size in bytes for blobs, null otherwise. */
  size: number | null;
  path: string;
}

export const SYMLINK_MODE = "120000";

/**
 * Entries of a commit's tree, read from git objects (plan 8.5): never the working tree, so the result
 * matches exactly what a checkout of that commit would contain.
 * @param dir a directory path inside the tree ("" for the root); only its direct children unless `recursive`
 */
export async function listTree(
  git: GitRunner,
  cwd: string,
  commit: string,
  opts: { recursive?: boolean; dir?: string } = {},
): Promise<TreeEntry[]> {
  assertOid(commit);
  const args = ["ls-tree", "-l", "-z", "--full-tree"];
  if (opts.recursive) args.push("-r");
  const treeish = opts.dir ? `${commit}:${opts.dir}` : commit;
  args.push("--end-of-options", treeish);
  const out = await git.text(args, { cwd, maxOutputBytes: 64 * 1024 * 1024 });
  const prefix = opts.dir ? `${opts.dir}/` : "";
  return out
    .split("\0")
    .filter((r) => r.length > 0)
    .map((record) => {
      const tab = record.indexOf("\t");
      const [mode = "", type = "", oid = "", size = "-"] = record.slice(0, tab).split(/ +/);
      return {
        mode,
        type: type as TreeEntry["type"],
        oid,
        size: size === "-" ? null : Number(size),
        path: prefix + record.slice(tab + 1),
      };
    });
}

/** Contents of `path` at `commit`, or null if there is no such blob. Fails above `maxBytes`. */
export async function readBlobAt(
  git: GitRunner,
  cwd: string,
  commit: string,
  path: string,
  maxBytes = 4 * 1024 * 1024,
): Promise<Buffer | null> {
  assertOid(commit);
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  let entries: TreeEntry[];
  try {
    entries = await listTree(git, cwd, commit, parent ? { dir: parent } : {});
  } catch (err) {
    if (err instanceof GitError && err.kind === "failed") return null; // parent directory does not exist
    throw err;
  }
  const entry = entries.find((e) => e.path === path);
  if (entry?.type !== "blob" || entry.mode === SYMLINK_MODE) return null;
  if (entry.size !== null && entry.size > maxBytes) {
    throw new GitError("output_too_large", `${path} is larger than ${maxBytes} bytes`);
  }
  return readBlob(git, cwd, entry.oid, maxBytes);
}

/** Contents of the blob `oid` (e.g. from listTree). Fails with output_too_large above `maxBytes`. */
export async function readBlob(git: GitRunner, cwd: string, oid: string, maxBytes: number): Promise<Buffer> {
  assertOid(oid);
  return (await git.run(["cat-file", "blob", oid], { cwd, maxOutputBytes: maxBytes })).stdout;
}

/** Resolve `refs/heads/<branch>` to a commit OID. */
export async function resolveBranch(git: GitRunner, cwd: string, branch: string): Promise<string> {
  const out = await git.text(["rev-parse", "--verify", "--end-of-options", `refs/heads/${branch}^{commit}`], { cwd });
  return assertOid(out.trim());
}
