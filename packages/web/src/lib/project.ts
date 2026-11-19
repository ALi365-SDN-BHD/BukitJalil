import { isThemeKey, type ProjectKey, type Site, type SiteReason } from "@bukitjalil/shared";

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

/**
 * The project's path, both under /api and in the app's routes: `/sites/<id>` for a site, `/themes/<id>`
 * for a theme project (whose key is already `themes/<id>`).
 */
export const projectPath = (key: ProjectKey): string => (isThemeKey(key) ? `/${key}` : `/sites/${key}`);
