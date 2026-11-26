import type { ErrorCode, Site } from "@bukitjalil/shared";
import { readBlob, treeEntryAt } from "../git/objects.ts";
import type { GitRunner } from "../git/run.ts";
import { editedTree } from "../git/temp-index.ts";
import { SiteError } from "./location.ts";
import type { SiteService } from "./service.ts";

/** The error codes a config commit reports, so each form keeps messages about itself. */
export interface ConfigCommitCodes {
  wrongBranch: ErrorCode;
  dirty: ErrorCode;
  changed: ErrorCode;
  failed: ErrorCode;
  invalid: ErrorCode;
}

/**
 * The site folder must be on its default branch and clean before a config commit can fast-forward it
 * (deploy settings, plan 14 M6; language migration, plan 8.7).
 */
export async function assertCheckoutReady(git: GitRunner, site: Site, codes: ConfigCommitCodes): Promise<void> {
  const branch = (await git.run(["symbolic-ref", "-q", "HEAD"], { cwd: site.path, okCodes: [1] })).stdout
    .toString("utf8")
    .trim();
  if (branch !== `refs/heads/${site.defaultBranch}`) {
    throw new SiteError(codes.wrongBranch, 409, { branch: site.defaultBranch });
  }
  const dirty = await git.text(["status", "--porcelain=v1", "-z", "--untracked-files=no"], { cwd: site.path });
  if (dirty !== "") throw new SiteError(codes.dirty, 409);
}

/**
 * Commit an edit of site.yaml on top of `head` as the user and fast-forward the default branch to it. The
 * edit reads the regular blob at `head` and writes a new blob in a temporary index. The caller holds the site lock.
 */
export async function commitSiteYaml(opts: {
  git: GitRunner;
  sites: SiteService;
  site: Site;
  head: string;
  tmpDir: string;
  maxBytes: number;
  message: string;
  codes: ConfigCommitCodes;
  edit: (text: string) => string;
}): Promise<void> {
  const { git, sites, site, head, codes } = opts;
  await assertCheckoutReady(git, site, codes);
  const entry = await treeEntryAt(git, site.path, head, site.configFile);
  if (
    !entry ||
    (entry.mode !== "100644" && entry.mode !== "100755") ||
    entry.size === null ||
    entry.size > opts.maxBytes
  )
    throw new SiteError(codes.invalid, 409);
  const text = (await readBlob(git, site.path, entry.oid, opts.maxBytes)).toString("utf8");
  const input = opts.edit(text);
  if (Buffer.byteLength(input) > opts.maxBytes) throw new SiteError(codes.invalid, 409);
  const oid = (await git.text(["hash-object", "-w", "--no-filters", "--stdin"], { cwd: site.path, input })).trim();
  const tree = await editedTree(git, site.path, head, `${entry.mode} ${oid}\t${site.configFile}\0`, opts.tmpDir);
  const identity = sites.commitIdentity();
  const commit = (
    await git.text(["commit-tree", tree, "-p", head, "-m", opts.message], {
      cwd: site.path,
      config: {
        "author.name": identity["user.name"],
        "author.email": identity["user.email"],
        "committer.name": identity["user.name"],
        "committer.email": identity["user.email"],
      },
    })
  ).trim();
  await assertCheckoutReady(git, site, codes);
  if ((await sites.repos.headOf(site)) !== head) throw new SiteError(codes.changed, 409);
  try {
    await git.run(["merge", "-q", "--ff-only", "--no-overwrite-ignore", "--end-of-options", commit], {
      cwd: site.path,
      config: identity,
    });
  } catch {
    throw new SiteError(codes.failed, 409);
  }
}
