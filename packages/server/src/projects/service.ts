import {
  type ConfigCheck,
  isThemeKey,
  type ProjectKey,
  type ProjectRef,
  parseProjectKey,
  projectKey,
  type Site,
  type SiteReason,
} from "@bukitjalil/shared";
import type { GuardResult } from "../bukit/guard.ts";
import { SiteError } from "../sites/location.ts";
import type { SiteService } from "../sites/service.ts";
import type { ThemeService } from "../themes/service.ts";
import type { ProjectRepos, RepoProject } from "./repo.ts";

/** What every project shares (theme development design 3.3): enough for checkouts, builds and changes. */
export interface Project extends RepoProject {
  key: ProjectKey;
  ref: ProjectRef;
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  configFile: string;
  readOnly: SiteReason[] | null;
  checkedCommit: string | null;
  configCheck: ConfigCheck | null;
}

/**
 * Sites and theme projects behind one key (design 3.3). Conversations, change sets, builds, checkouts,
 * previews, panels and the AI tools take a project key and use this; Notion, publishing, SEO, plugins and
 * media uploads take a site (`site`), which a theme key never is.
 */
export class ProjectService {
  constructor(
    readonly sites: SiteService,
    readonly themes: ThemeService,
    readonly repos: ProjectRepos,
  ) {}

  /** The project `key` names; 404 site.not_found / theme.not_found when there is none. */
  get(key: ProjectKey): Project {
    const ref = this.ref(key);
    const { id, name, path, defaultBranch, configFile, readOnly, checkedCommit, configCheck } =
      ref.kind === "site" ? this.sites.get(ref.id) : this.themes.get(ref.id);
    return { key, ref, id, name, path, defaultBranch, configFile, readOnly, checkedCommit, configCheck };
  }

  /** What `key` names, without reading the project; 404 when the key is malformed. */
  private ref(key: ProjectKey): ProjectRef {
    const ref = parseProjectKey(key);
    if (!ref) throw new SiteError(isThemeKey(key) ? "theme.not_found" : "site.not_found", 404);
    return ref;
  }

  /** The site `key` names, for features only sites have; a theme key is 404 site.not_found. */
  site(key: ProjectKey): Site {
    const ref = parseProjectKey(key);
    if (ref?.kind !== "site") throw new SiteError("site.not_found", 404);
    return this.sites.get(ref.id);
  }

  isSite(key: ProjectKey): boolean {
    return parseProjectKey(key)?.kind === "site";
  }

  /** Run `hook` after a project is created or imported and checked. */
  onAdded(hook: (key: ProjectKey) => Promise<void>): void {
    this.sites.onAdded((site) => hook(site.id));
    this.themes.onAdded((theme) => hook(projectKey({ kind: "theme", id: theme.id })));
  }

  /** Run `hook` before a project's files are removed. */
  onRemoving(hook: (key: ProjectKey) => Promise<void>): void {
    this.sites.onRemoving(hook);
    this.themes.onRemoving(hook);
  }

  /** The AI's working copy of the project (plan 6.1); see ProjectRepos.aiWorktree. */
  aiWorktree(key: ProjectKey, commit: string, opts: { reset: boolean }): Promise<string> {
    return this.repos.aiWorktree(key, this.get(key), commit, opts);
  }

  /** The project's main/ checkout at `commit`; the caller holds the project lock. */
  mainCheckout(key: ProjectKey, commit: string): Promise<string> {
    return this.repos.mainCheckout(key, this.get(key).path, commit);
  }

  headOf(project: RepoProject): Promise<string> {
    return this.repos.headOf(project);
  }

  /** The commit identity from the settings, as git config (400 `site.identity_required` when unset). */
  commitIdentity(): { "user.name": string; "user.email": string } {
    return this.sites.commitIdentity();
  }

  /** Record what a build's pre-build guard found for `commit` (plan 8.5); the caller holds the lock. */
  applyGuard(key: ProjectKey, commit: string, guard: GuardResult): void {
    const ref = this.ref(key);
    if (ref.kind === "site") this.sites.applyGuard(ref.id, commit, guard);
    else this.themes.applyGuard(ref.id, commit, guard);
  }

  /** The bound Notion token of a site (see SiteService.notionToken); theme projects have none. */
  notionToken(key: ProjectKey): string | null {
    const ref = this.ref(key);
    return ref.kind === "site" ? this.sites.notionToken(ref.id) : null;
  }

  /** The saved Notion data source bound to a site; null for theme projects. */
  notionDataSourceId(key: ProjectKey): string | null {
    const ref = this.ref(key);
    return ref.kind === "site" ? this.sites.notionDataSourceId(ref.id) : null;
  }

  /** Directories of every registered project, for the location rules and the shared exclude block. */
  all(): { name: string; path: string }[] {
    return [...this.sites.list(), ...this.themes.list()];
  }
}
