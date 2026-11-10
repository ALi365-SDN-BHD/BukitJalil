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

/** The entry at `path` in `commit`'s tree ("" is not an entry), or null when there is none. */
export async function treeEntryAt(
  git: GitRunner,
  cwd: string,
  commit: string,
  path: string,
): Promise<TreeEntry | null> {
  if (path === "") return null;
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  try {
    const entries = await listTree(git, cwd, commit, parent ? { dir: parent } : {});
    return entries.find((e) => e.path === path) ?? null;
  } catch (err) {
    if (err instanceof GitError && err.kind === "failed") return null; // parent directory does not exist
    throw err;
  }
}

/** Contents of `path` at `commit`, or null if there is no such blob (symlinks included). Fails above `maxBytes`. */
export async function readBlobAt(
  git: GitRunner,
  cwd: string,
  commit: string,
  path: string,
  maxBytes = 4 * 1024 * 1024,
): Promise<Buffer | null> {
  assertOid(commit);
  const entry = await treeEntryAt(git, cwd, commit, path);
  if (entry?.type !== "blob" || entry.mode === SYMLINK_MODE) return null;
  if (entry.size !== null && entry.size > maxBytes) {
    throw new GitError("output_too_large", `${path} is larger than ${maxBytes} bytes`, { max: maxBytes });
  }
  return readBlob(git, cwd, entry.oid, maxBytes);
}

/** Contents of the blob `oid` (e.g. from listTree). Fails with output_too_large above `maxBytes`. */
export async function readBlob(git: GitRunner, cwd: string, oid: string, maxBytes: number): Promise<Buffer> {
  assertOid(oid);
  return (await git.run(["cat-file", "blob", oid], { cwd, maxOutputBytes: maxBytes })).stdout;
}

/** The first `n` bytes of the blob `oid`, without holding the rest in memory. */
export async function readBlobHead(git: GitRunner, cwd: string, oid: string, n: number): Promise<Buffer> {
  assertOid(oid);
  return (await git.run(["cat-file", "blob", oid], { cwd, headBytes: n })).stdout;
}

/** Resolve `refs/heads/<branch>` to a commit OID. */
export async function resolveBranch(git: GitRunner, cwd: string, branch: string): Promise<string> {
  const out = await git.text(["rev-parse", "--verify", "--end-of-options", `refs/heads/${branch}^{commit}`], { cwd });
  return assertOid(out.trim());
}

/**
 * Contents of many blobs with one `git cat-file --batch` (the data panel reads every Markdown file of a
 * source). Missing objects and non-blobs are left out of the result.
 */
export async function readBlobs(
  git: GitRunner,
  cwd: string,
  oids: readonly string[],
  maxTotalBytes: number,
): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  if (oids.length === 0) return result;
  for (const oid of oids) assertOid(oid);
  const out = (
    await git.run(["cat-file", "--batch"], {
      cwd,
      input: `${oids.join("\n")}\n`,
      // Each record adds a header line ("<oid> blob <size>\n") and a newline after the content.
      maxOutputBytes: maxTotalBytes + oids.length * 100,
    })
  ).stdout;
  let pos = 0;
  while (pos < out.length) {
    const eol = out.indexOf(0x0a, pos);
    if (eol < 0) break;
    const [oid = "", type = "", sizeText = ""] = out.subarray(pos, eol).toString("utf8").split(" ");
    pos = eol + 1;
    if (type === "missing" || sizeText === "") continue;
    const size = Number(sizeText);
    if (type === "blob") result.set(oid, out.subarray(pos, pos + size));
    pos += size + 1;
  }
  return result;
}
