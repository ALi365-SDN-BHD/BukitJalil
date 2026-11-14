import fs from "node:fs";
import path from "node:path";
import type { ErrorCode, Site } from "@bukitjalil/shared";
import type { GitRunner } from "../git/run.ts";
import { SiteError } from "./location.ts";
import type { SiteService } from "./service.ts";

/** The error codes a config commit reports, so each form keeps messages about itself. */
export interface ConfigCommitCodes {
  wrongBranch: ErrorCode;
  dirty: ErrorCode;
  changed: ErrorCode;
  failed: ErrorCode;
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
 * edit runs in the main checkout at `head`; `edit` gets the file's text and returns the new text. The caller
 * holds the site lock. The checkout is reset to `head` afterwards, whatever happens.
 */
export async function commitSiteYaml(opts: {
  git: GitRunner;
  sites: SiteService;
  site: Site;
  head: string;
  message: string;
  codes: ConfigCommitCodes;
  edit: (text: string) => string;
}): Promise<void> {
  const { git, sites, site, head, codes } = opts;
  await assertCheckoutReady(git, site, codes);
  const checkout = await sites.mainCheckout(site.id, site.path, head);
  try {
    const file = path.join(checkout, "site.yaml");
    const text = await fs.promises.readFile(file, "utf8");
    await fs.promises.writeFile(file, opts.edit(text));
    await git.run(["add", "--", "site.yaml"], { cwd: checkout });
    const tree = (await git.text(["write-tree"], { cwd: checkout })).trim();
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
    if ((await sites.headOf(site)) !== head) throw new SiteError(codes.changed, 409);
    try {
      await git.run(["merge", "-q", "--ff-only", "--no-overwrite-ignore", "--end-of-options", commit], {
        cwd: site.path,
        config: identity,
      });
    } catch {
      throw new SiteError(codes.failed, 409);
    }
  } finally {
    await git.run(["reset", "-q", "--hard", head], { cwd: checkout }).catch(() => {});
  }
}
