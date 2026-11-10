/** Where a site is published (plan 14 M6): the `deploy` section of site.yaml on the default branch. */
export interface DeployTarget {
  /** owner/name; null when not set or not valid. */
  repo: string | null;
  branch: string;
  cname: string | null;
  /** Where GitHub Pages should serve the site, when it can be told. */
  url: string | null;
  /** Why the site cannot be published to this target yet. */
  problem: "no_config" | "not_configured" | "bad_provider" | "bad_repo" | "bad_branch" | null;
}

/** GET /api/sites/:id/deploy. */
export interface DeployStatusResponse {
  /** The default-branch commit the target was read from. */
  commit: string;
  target: DeployTarget;
  /** A GitHub token is set (plan 6.5). */
  token: boolean;
  /** Target valid, token set and the site not read-only. */
  ready: boolean;
}

/** Default branch of `bukit deploy` (2.0.12). */
export const DEFAULT_DEPLOY_BRANCH = "gh-pages";
