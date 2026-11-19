import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type ProjectKey, projectKey, type SitePatch, type Theme, type ThemeOrigin } from "@bukitjalil/shared";
import type { GuardResult } from "../bukit/guard.ts";
import type { AppPaths } from "../paths.ts";
import type { Prechecked, ProjectRepos, ProjectState } from "../projects/repo.ts";
import { checkSiteLocation, SiteError } from "../sites/location.ts";
import type { SiteLocks } from "../sites/locks.ts";
import type { SettingsStore } from "../store/settings.ts";
import { newThemeId, ThemeStore } from "./store.ts";

export interface ThemeServiceOptions {
  db: DatabaseSync;
  paths: AppPaths;
  /** Overrides os.homedir() (tests). */
  userHome?: string;
  settings: SettingsStore;
  locks: SiteLocks;
  repos: ProjectRepos;
  /** Directories of the registered sites: a theme project may not overlap them (design 3.1). */
  otherProjects: () => { name: string; path: string }[];
}

/** The project key of a theme project. */
export const themeKey = (id: string): ProjectKey => projectKey({ kind: "theme", id });

/**
 * Theme projects (theme development design 3.2): registration, safety state and removal. Like a site, a
 * theme project that fails the repository or pre-build checks is kept but read-only. Making one (new,
 * import, clone) comes with T1–T3.
 */
export class ThemeService {
  readonly store: ThemeStore;
  private readonly addedHooks: ((theme: Theme) => Promise<void>)[] = [];
  private readonly removingHooks: ((key: ProjectKey) => Promise<void>)[] = [];

  constructor(private readonly opts: ThemeServiceOptions) {
    this.store = new ThemeStore(opts.db);
  }

  list(): Theme[] {
    return this.store.list();
  }

  get(id: string): Theme {
    const theme = this.store.get(id);
    if (!theme) throw new SiteError("theme.not_found", 404);
    return theme;
  }

  /** Run `hook` after a theme project is made and checked (the build service starts its first build). */
  onAdded(hook: (theme: Theme) => Promise<void>): void {
    this.addedHooks.push(hook);
  }

  /** Run `hook` before a theme project's files are removed (the agent service stops its sessions). */
  onRemoving(hook: (key: ProjectKey) => Promise<void>): void {
    this.removingHooks.push(hook);
  }

  /**
   * Where a theme project may live, as its real path: the same rules as a site (plan 5.2), and it may not
   * overlap a registered site or theme project.
   */
  location(target: string): string {
    return checkSiteLocation(target, {
      appHome: this.opts.paths.home,
      userHome: this.opts.userHome,
      sites: this.opts.otherProjects(),
      themes: this.store.list(),
    });
  }

  /**
   * Record a repository the caller made or checked at `real` (T1–T3) and run the safety checks; the
   * caller holds the path with `repos.reserved`. The location rules are checked again here.
   */
  async register(
    real: string,
    entry: { name: string; themeName: string; defaultBranch: string; configFile: string; origin: ThemeOrigin },
    checked?: Prechecked,
  ): Promise<Theme> {
    this.location(real);
    await this.opts.repos.assertBranch(entry.defaultBranch, real);
    const id = newThemeId();
    try {
      this.store.insert({ id, path: real, ...entry });
    } catch (err) {
      if (/UNIQUE/i.test((err as Error).message)) throw new SiteError("site.already_registered", 409);
      throw err;
    }
    this.opts.settings.update({ lastParentDir: path.dirname(real) });
    const theme = await this.check(id, checked);
    for (const hook of this.addedHooks) await hook(theme);
    return theme;
  }

  /** Run the safety checks again (`POST /recheck`). */
  recheck(id: string): Promise<Theme> {
    return this.check(id);
  }

  /** Record what a build's pre-build guard found (plan 8.5): a refused commit makes the project read-only. */
  applyGuard(id: string, commit: string, guard: GuardResult): void {
    if (!guard.ok) this.store.setState(id, { readOnly: guard.reasons, checkedCommit: commit, configCheck: null });
  }

  private async check(id: string, checked?: Prechecked): Promise<Theme> {
    const theme = this.get(id);
    await this.opts.locks.run(themeKey(id), "recheck", async () => {
      let state: ProjectState;
      try {
        state = await this.opts.repos.evaluate(themeKey(id), theme, checked);
      } catch (err) {
        const detail = err instanceof Error ? err.message.slice(0, 500) : String(err);
        state = { readOnly: [{ code: "not_checked", detail }], checkedCommit: null, configCheck: null };
      }
      this.store.setState(id, state);
    });
    return this.get(id);
  }

  patch(id: string, patch: SitePatch): Theme {
    this.get(id);
    this.store.patch(id, patch);
    return this.get(id);
  }

  touch(id: string): void {
    this.get(id);
    this.store.touch(id);
  }

  /**
   * Remove a theme project from BukitJalil: its checkouts, change refs, exclude block, sessions and
   * previews. The project directory itself is never deleted.
   */
  async remove(id: string): Promise<{ leftovers: string[] }> {
    const theme = this.get(id);
    const key = themeKey(id);
    for (const hook of this.removingHooks) await hook(key);
    return this.opts.locks.run(key, "remove", async () => {
      for (const hook of this.removingHooks) await hook(key);
      const others = [...this.store.list().filter((other) => other.id !== id), ...this.opts.otherProjects()].map(
        (p) => p.path,
      );
      const leftovers = await this.opts.repos.removeFiles(key, theme, others);
      this.store.delete(id);
      return { leftovers };
    });
  }
}
