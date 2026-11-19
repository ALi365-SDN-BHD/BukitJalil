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
    /** `clone` makes the project from a desktop capture (design 6.2); omitted means a new theme. */
    origin: z.enum(["new", "clone"]).optional(),
    /** The capture directory under the app data folder, from the desktop capture. */
    captureId: z
      .string()
      .regex(/^[0-9a-f]{16,64}$/)
      .optional(),
    /** The user confirmed the captured site is theirs or they may copy it (design 6.1). */
    authorized: z.boolean().optional(),
  })
  .strict();
export type CreateThemeRequest = z.infer<typeof CreateThemeRequest>;

/**
 * Apply a theme project to a site (design 7): the site's change set copies `themes/<name>/` from the theme
 * project's default branch. `overwrite` is required when the site has that theme already; `setConfig` also
 * points the site's `theme.name` at it.
 */
export const ThemeApplyRequest = z
  .object({
    siteId: z.string().regex(/^[0-9a-f]{16}$/),
    overwrite: z.boolean().optional(),
    setConfig: z.boolean().optional(),
  })
  .strict();
export type ThemeApplyRequest = z.infer<typeof ThemeApplyRequest>;

/** What applying a theme would change on a site, shown before the user confirms (design 7). */
export interface ThemeApplyPlan {
  site: { id: string; name: string };
  theme: { name: string; dir: string };
  /** The site's default branch already has `themes/<name>/`. */
  existing: boolean;
  added: string[];
  modified: string[];
  removed: string[];
  /** The `theme.name` in the site's config on its default branch; null when it has none or it cannot be read. */
  configTheme: string | null;
}

/** The change set applying a theme made on the site; null when the site already had exactly this theme. */
export interface ThemeApplyResult {
  siteId: string;
  changeId: string | null;
}

/** Inspect a folder or zip before importing a theme from it (design 5). */
export const InspectThemeRequest = z.object({ path: AbsolutePath }).strict();
export type InspectThemeRequest = z.infer<typeof InspectThemeRequest>;

/** A theme found in an import source (design 5). */
export interface ThemeCandidate {
  /** What an import request sends back: the theme's directory inside the source. */
  id: string;
  /** Where it is written in the new project: `themes/<dir>/`; also the theme's name. */
  dir: string;
  displayName: string | null;
  /** Every directory copied with it, `extends` parents first. */
  includes: string[];
  /** A parent theme the source does not contain; the candidate cannot be imported. */
  missingParent: string | null;
}

/** What a folder or zip holds for a theme import; nothing is written by inspecting. */
export interface ThemeImportInspection {
  path: string;
  /** The folder is also a Bukit site, which the site import can take instead. */
  site: { configFile: string } | null;
  themes: ThemeCandidate[];
}

/** Import the chosen theme (with its parents) as a new theme project (design 5). */
export const ImportThemeRequest = z
  .object({
    /** The folder or zip that was inspected. */
    source: AbsolutePath,
    /** `ThemeCandidate.id`, checked again against the source. */
    theme: z.string().min(1).max(300),
    /** The new theme project's directory; it must not exist or be empty. */
    path: AbsolutePath,
    name: SiteName,
    language: SiteLanguage,
  })
  .strict();
export type ImportThemeRequest = z.infer<typeof ImportThemeRequest>;
