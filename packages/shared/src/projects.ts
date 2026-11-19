import { z } from "zod";
import { ReferenceImages } from "./sessions.ts";
import { AbsolutePath, type ConfigCheck, SiteLanguage, SiteName, type SiteReason } from "./sites.ts";

/**
 * Projects (theme development design 3.2, 3.3): a site or a theme project. Both are git repositories that
 * Bukit builds, and share conversations, change sets, builds, checkouts and previews.
 */
export type ProjectKind = "site" | "theme";

export interface ProjectRef {
  kind: ProjectKind;
  id: string;
}

/**
 * A project in one string: the site id for a site, `themes/<themeId>` for a theme project. It is also the
 * path segment under worktrees/, sessions/ and previews/ (so sites keep their directories), the key of the
 * project's operation lock, and what events and API clients use to tell projects apart. Ids of both kinds
 * are 16 lower-case hex characters, so the two shapes never collide.
 */
export type ProjectKey = string;

export const PROJECT_ID = /^[0-9a-f]{16}$/;
export const THEME_KEY_PREFIX = "themes/";

export const isProjectId = (id: string) => PROJECT_ID.test(id);

export function projectKey(ref: ProjectRef): ProjectKey {
  return ref.kind === "site" ? ref.id : `${THEME_KEY_PREFIX}${ref.id}`;
}

/** The project a key names, or null when it is not a well-formed key. */
export function parseProjectKey(key: string): ProjectRef | null {
  if (key.startsWith(THEME_KEY_PREFIX)) {
    const id = key.slice(THEME_KEY_PREFIX.length);
    return isProjectId(id) ? { kind: "theme", id } : null;
  }
  return isProjectId(key) ? { kind: "site", id: key } : null;
}

export const isThemeKey = (key: ProjectKey) => key.startsWith(THEME_KEY_PREFIX);

/** How a theme project was made (design 4, 5, 6). */
export type ThemeOrigin = "new" | "import" | "clone";

/** A theme project (design 3.2): its deliverable is `themes/<themeName>/` in the repository at `path`. */
export interface Theme {
  id: string;
  name: string;
  /** The Bukit theme's directory name and `theme.name`. */
  themeName: string;
  path: string;
  defaultBranch: string;
  createdAt: string;
  lastOpenedAt: string | null;
  archived: boolean;
  /** null: usable. Otherwise read-only, with the reasons (same rules as a site, plan 5.1). */
  readOnly: SiteReason[] | null;
  checkedCommit: string | null;
  configCheck: ConfigCheck | null;
  /** The sample site's config file. */
  configFile: string;
  origin: ThemeOrigin;
}

/**
 * A Bukit theme's directory name and `theme.name`: Bukit's characters ([A-Za-z0-9_.-], no "..", not a
 * Windows device name), starting with a letter or digit so it is never hidden or read as an option.
 */
export const ThemeName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/)
  .refine((s) => !s.includes(".."), "must not contain ..")
  .refine((s) => !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s), "must not be a Windows device name");

/**
 * A new theme project from a description (design 4): Bukit's starter with the theme renamed and the bundled
 * sample content. The description goes into the first conversation (prefilled), not this request.
 */
export const CreateThemeRequest = z
  .object({
    /** Display name of the project; also the sample site's title. */
    name: SiteName,
    themeName: ThemeName,
    /** The new project directory itself; it must not exist or be empty. */
    path: AbsolutePath,
    language: SiteLanguage,
    /** Reference images (design 4.2), written into _reference/ with the first commit. */
    images: ReferenceImages.optional(),
  })
  .strict();
export type CreateThemeRequest = z.infer<typeof CreateThemeRequest>;
