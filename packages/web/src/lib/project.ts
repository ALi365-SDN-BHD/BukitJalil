import { isThemeKey, type ProjectKey, projectKey, type Site, type SiteReason, type Theme } from "@bukitjalil/shared";

/**
 * What the project views (conversation, changes, panels, builds) need of a site or theme project
 * (theme development design 3.3).
 */
export interface ProjectInfo {
  key: ProjectKey;
  /** null: usable; otherwise read-only, with the reasons. */
  readOnly: SiteReason[] | null;
}

export const siteProject = (site: Site): ProjectInfo => ({ key: site.id, readOnly: site.readOnly });

export const themeKey = (id: string): ProjectKey => projectKey({ kind: "theme", id });

export const themeProject = (theme: Theme): ProjectInfo => ({ key: themeKey(theme.id), readOnly: theme.readOnly });

/** The two ways of working (theme development design 2): building sites, and developing themes. */
export type Mode = "site" | "theme";

/** The mode a path of the app belongs to. */
export const modeOf = (pathname: string): Mode =>
  pathname === "/themes" || pathname.startsWith("/themes/") ? "theme" : "site";

/**
 * The project's path, both under /api and in the app's routes: `/sites/<id>` for a site, `/themes/<id>`
 * for a theme project (whose key is already `themes/<id>`).
 */
export const projectPath = (key: ProjectKey): string => (isThemeKey(key) ? `/${key}` : `/sites/${key}`);
