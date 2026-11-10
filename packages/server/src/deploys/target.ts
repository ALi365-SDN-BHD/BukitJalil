import { DEFAULT_DEPLOY_BRANCH, type DeployTarget } from "@bukitjalil/shared";
import { isRecord } from "../bukit/guard.ts";

/** The repo pattern of Bukit 2.0.12's config schema (deploy.repo). */
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.{1,2}$)(?!.*\.[Gg][Ii][Tt]$)[A-Za-z0-9._-]{1,100}$/;
/** A branch name git accepts and that cannot be read as an option. */
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*\.lock$)(?!.*[/.]$)[A-Za-z0-9._/-]{1,100}$/;
/** A plain host name for deploy.cname. */
const HOST =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** The publish target from parsed site.yaml (null when it could not be read). */
export function deployTarget(config: Record<string, unknown> | null): DeployTarget {
  const empty: DeployTarget = { repo: null, branch: DEFAULT_DEPLOY_BRANCH, cname: null, url: null, problem: null };
  if (!config) return { ...empty, problem: "no_config" };
  const deploy = config.deploy;
  if (!isRecord(deploy) || deploy.repo === undefined) return { ...empty, problem: "not_configured" };
  if (deploy.provider !== undefined && deploy.provider !== "github-pages") return { ...empty, problem: "bad_provider" };
  const branch = deploy.branch === undefined ? DEFAULT_DEPLOY_BRANCH : deploy.branch;
  const cname = typeof deploy.cname === "string" && HOST.test(deploy.cname) ? deploy.cname.toLowerCase() : null;
  if (typeof deploy.repo !== "string" || !REPO.test(deploy.repo)) return { ...empty, cname, problem: "bad_repo" };
  const repo = deploy.repo;
  if (typeof branch !== "string" || !BRANCH.test(branch)) return { ...empty, repo, cname, problem: "bad_branch" };
  return { repo, branch, cname, url: pagesUrl(repo, cname), problem: null };
}

/** Where GitHub Pages serves `repo`: the custom domain, the user / organization site, or a project site. */
export function pagesUrl(repo: string, cname: string | null): string {
  if (cname) return `https://${cname}/`;
  const [owner, name] = repo.split("/") as [string, string];
  const host = `${owner.toLowerCase()}.github.io`;
  return name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${name}/`;
}
