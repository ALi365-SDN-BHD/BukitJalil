import { z } from "zod";

/** Build phases a Bukit built-in plugin can take part in. */
export type BukitPluginStage = "derive" | "htmlTransform" | "afterBuild";

/**
 * Bukit 2.0.15 built-in plugins that `site.plugins` can switch (guide/skills/bukit-config). Sitemap,
 * feed, search-index, llms-txt and responsive-images are output settings or part of image-processing,
 * not plugin toggles; see BUKIT_OUTPUT_SETTINGS.
 */
export const BUKIT_BUILTIN_PLUGINS = [
  { id: "alias", stages: ["derive"] },
  { id: "analytics", stages: ["htmlTransform"] },
  { id: "archive", stages: ["derive"] },
  { id: "data-files", stages: ["derive"] },
  { id: "image-processing", stages: ["htmlTransform", "afterBuild"] },
  { id: "menu", stages: ["afterBuild"] },
  { id: "pages-index", stages: ["derive"] },
  { id: "pagination", stages: ["derive"] },
  { id: "related-content", stages: ["derive"] },
  { id: "taxonomy", stages: ["derive", "afterBuild"] },
] as const satisfies readonly { id: string; stages: readonly BukitPluginStage[] }[];

export type BukitPluginId = (typeof BUKIT_BUILTIN_PLUGINS)[number]["id"];

export function isBukitPluginId(value: string): value is BukitPluginId {
  return BUKIT_BUILTIN_PLUGINS.some((plugin) => plugin.id === value);
}

/** Site settings each built-in plugin reads besides its own switch, shown as hints in the UI. */
export const BUKIT_PLUGIN_CONFIG: Record<BukitPluginId, readonly string[]> = {
  alias: ["site.plugins.alias"],
  analytics: ["site.plugins.analytics", "site.analytics"],
  archive: ["site.plugins.archive", "site.collections.*.output.archive"],
  "data-files": ["site.plugins.data-files", "data/"],
  "image-processing": ["site.plugins.image-processing", "theme.images"],
  menu: ["site.plugins.menu", "site.menus"],
  "pages-index": ["site.plugins.pages-index"],
  pagination: ["site.plugins.pagination", "site.collections.*.pagination"],
  "related-content": ["site.plugins.related-content", "site.related"],
  taxonomy: ["site.plugins.taxonomy", "taxonomy.kinds"],
};

/** Accepted in `site.plugins` but not a switch of a registered built-in plugin. */
export const BUKIT_OUTPUT_SETTINGS = ["feed", "llms-txt", "responsive-images", "search-index", "sitemap"] as const;

/** The effective switch of one built-in plugin for one site. */
export interface BukitPluginState {
  id: BukitPluginId;
  /** Defaults to true: an absent `site.plugins` entry does not mean off. */
  enabled: boolean;
  /** Whether `site.plugins.<id>` is present (either on or off). */
  configured: boolean;
}

/** PUT /api/sites/:siteId/plugins/:pluginId. */
export const PluginToggleRequest = z.object({ enabled: z.boolean() }).strict();
export type PluginToggleRequest = z.infer<typeof PluginToggleRequest>;
