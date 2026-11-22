import {
  isThemeKey,
  type ProjectKey,
  parseContentKey,
  projectKey,
  type Site,
  type SiteReason,
  type Theme,
} from "@bukitjalil/shared";

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

/**
 * The three ways of working: building sites, developing themes (theme development design 2), and managing
 * the content of Notion data sources (plan 5.6).
 */
export type Mode = "site" | "theme" | "content";

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The mode a path of the app belongs to. */
export const modeOf = (pathname: string): Mode =>
  under(pathname, "/themes") ? "theme" : under(pathname, "/content") ? "content" : "site";

/**
 * A Notion id as the server keeps it: 32 lowercase hex digits, without the dashes Notion's own ids may have;
 * null for anything else. Routes keep the id as it came, so compare and key by this.
 */
export function canonicalNotionId(id: string): string | null {
  const plain = id.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(plain) ? plain : null;
}

/** A Notion database in content management (plan 5.6): `/content/sources/<id>/databases/<id>`. */
export const contentDatabasePath = (sourceId: string, databaseId: string): string =>
  `/content/sources/${encodeURIComponent(sourceId)}/databases/${encodeURIComponent(databaseId)}`;

/**
 * The project's path, both under /api and in the app's routes: `/sites/<id>` for a site, `/themes/<id>`
 * for a theme project (whose key is already `themes/<id>`), and the database's path for the conversations
 * of a content database (`content/<source>/<database>`).
 */
export const projectPath = (key: ProjectKey): string => {
  if (isThemeKey(key)) return `/${key}`;
  const content = parseContentKey(key);
  return content ? contentDatabasePath(content.sourceId, content.databaseId) : `/sites/${key}`;
};

/** An entry of a content database; `new` for the page being created. */
export const contentPagePath = (sourceId: string, databaseId: string, pageId: string): string =>
  `${contentDatabasePath(sourceId, databaseId)}/pages/${encodeURIComponent(pageId)}`;
