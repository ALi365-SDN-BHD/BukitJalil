import { z } from "zod";

/** Sites, directory picker and import (plan 5.1, 5.2, 9.1). */

const AbsolutePath = z.string().min(1).max(4096).regex(/^\//, "must be an absolute path");
/** Display name: also written into site.yaml as site.title. Control and format characters are refused. */
export const SiteName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((s) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(s), "must not contain control characters");
/** BCP 47 language tag, e.g. zh-CN or en-US. */
export const SiteLanguage = z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);

export const CreateSiteRequest = z
  .object({
    name: SiteName,
    /** The new site directory itself; it must not exist or be empty. */
    path: AbsolutePath,
    language: SiteLanguage,
    /** Optional first message for the AI (plan 5.2 step 6; used from M3). */
    description: z.string().max(4000).optional(),
  })
  .strict();
export type CreateSiteRequest = z.infer<typeof CreateSiteRequest>;

export const InspectImportRequest = z.object({ path: AbsolutePath }).strict();

export const ImportSiteRequest = z
  .object({
    path: AbsolutePath,
    name: SiteName.optional(),
    /**
     * Only for a directory that is not a git repository: the user agreed to `git init` and saw exactly
     * these files (from the inspect response) go into the first commit. A different list is refused.
     */
    initGit: z
      .object({ files: z.array(z.string()).max(100_000) })
      .strict()
      .optional(),
  })
  .strict();
export type ImportSiteRequest = z.infer<typeof ImportSiteRequest>;

/** What import would do with a directory; nothing is changed by inspecting. */
export type ImportInspection =
  | { kind: "git"; path: string; branch: string; readOnly: SiteReason[] | null }
  | { kind: "not_git"; path: string; files: string[] };

export const SitePatch = z.object({ name: SiteName.optional(), archived: z.boolean().optional() }).strict();
export type SitePatch = z.infer<typeof SitePatch>;

export type SiteReasonCode =
  | "missing_site_yaml"
  | "invalid_site_yaml"
  | "symlink"
  | "plugin_files"
  | "unknown_plugin"
  | "unsafe_path"
  | "unsafe_route"
  | "private_network_allowed"
  | "lfs"
  | "case_collision"
  | "repo_config"
  | "dubious_ownership"
  /** The check has not finished yet (new row) or could not run to the end. */
  | "not_checked"
  /** The site directory is gone or no longer a git repository root. */
  | "missing_dir"
  /** The default branch no longer exists. */
  | "missing_branch";

/** Why a site is read-only; `where` is a file, a site.yaml field or a git config key. */
export interface SiteReason {
  code: SiteReasonCode;
  where?: string;
  detail?: string;
}

export type ConfigCheck = "ok" | "failed" | "not_run" | "notion";

export interface Site {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  createdAt: string;
  lastOpenedAt: string | null;
  archived: boolean;
  /** null: usable. Otherwise read-only, with the reasons (plan 5.1). */
  readOnly: SiteReason[] | null;
  checkedCommit: string | null;
  configCheck: ConfigCheck | null;
}

export interface FsDirsResponse {
  path: string;
  /** null at the file system root. */
  parent: string | null;
  dirs: string[];
}

export interface GitIdentityResponse {
  name: string | null;
  email: string | null;
}
