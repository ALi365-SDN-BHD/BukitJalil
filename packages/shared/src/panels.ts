import { z } from "zod";
import type { BukitPluginState } from "./plugins.ts";

/** Read-only panels (plan 5.3, 9.1): files, config, theme and data, all read from git objects. */

/** Which version a panel shows: the default branch, or the open change set's snapshot (from M4). */
export const PanelRef = z.enum(["main", "change"]);
export type PanelRef = z.infer<typeof PanelRef>;

/**
 * A path inside the repository tree, "" for the root: "/"-separated, no empty, "." or ".." parts and no
 * NUL. git would read "./x" or "../x" in `<commit>:<path>` relative to the working directory.
 */
export const TreePath = z
  .string()
  .max(4096)
  .refine((p) => p === "" || p.split("/").every((s) => s !== "" && s !== "." && s !== ".." && !s.includes("\0")), {
    message: "must be a relative path inside the repository",
  });

export const TreeQuery = z.object({ ref: PanelRef.default("main"), path: TreePath.default("") });

/** `as`: json (default) describes the file; raw serves a verified bitmap image; download sends any file. */
export const FileQuery = z.object({
  ref: PanelRef.default("main"),
  path: TreePath.refine((p) => p !== "", { message: "must name a file" }),
  as: z.enum(["json", "raw", "download"]).default("json"),
});

export const RefQuery = z.object({ ref: PanelRef.default("main") });

export type TreeEntryKind = "dir" | "file" | "symlink" | "submodule";

export interface TreeEntryView {
  name: string;
  path: string;
  kind: TreeEntryKind;
  /** Bytes, for files and symlinks. */
  size: number | null;
}

export interface TreeResponse {
  ref: PanelRef;
  commit: string;
  path: string;
  /** Directories first, then by name; at most the server's per-directory cap. */
  entries: TreeEntryView[];
  /** More entries exist in this directory than `entries` holds. */
  truncated: boolean;
}

interface FileBase {
  ref: PanelRef;
  commit: string;
  path: string;
}

export type FileResponse =
  | (FileBase & { kind: "text"; size: number; content: string })
  /** A PNG, JPEG, GIF or WebP, recognized by its bytes; shown via `as=raw`. */
  | (FileBase & { kind: "image"; size: number; mime: ImageMime })
  /** Anything else that is not UTF-8 text (SVG and HTML are text): only `as=download`. */
  | (FileBase & { kind: "binary"; size: number })
  /** Over the inline limit (1 MiB, or 16 MiB for images) and not a shown image; only `as=download`. */
  | (FileBase & { kind: "too_large"; size: number })
  | (FileBase & { kind: "symlink"; target: string })
  | (FileBase & { kind: "submodule"; target: string });

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** site.yaml as a structured view and as text (plan 5.3). */
export interface ConfigResponse {
  ref: PanelRef;
  commit: string;
  /** null when the version has no site.yaml. */
  raw: string | null;
  /** YAML error, or "not a mapping"; `config` and `summary` are null then. */
  error: string | null;
  config: unknown;
  summary: ConfigSummary | null;
}

export interface ConfigSummary {
  site: {
    name: string | null;
    title: string | null;
    description: string | null;
    url: string | null;
    baseUrl: string | null;
    language: string | null;
    languages: string[];
    timezone: string | null;
  };
  collections: { name: string; permalink: string | null; listRoute: string | null }[];
  sources: { name: string | null; type: string | null; mode: string | null; collection: string | null }[];
  build: { output: string | null; draft: boolean | null; clean: boolean | null };
  theme: { name: string | null };
  /** Raw keys of site.plugins, including names that are not built-in plugins. */
  plugins: string[];
  /** Effective state of the built-in plugins; null when site.plugins is not a mapping. */
  pluginStates: BukitPluginState[] | null;
  /** Top-level sections besides site, content, build and theme, e.g. deploy or logging. */
  otherSections: string[];
}

export interface ThemeResponse {
  ref: PanelRef;
  commit: string;
  /** theme.name, or null when site.yaml has none (or none usable). */
  name: string | null;
  /** themes/<name>, when it exists in this version. */
  dir: string | null;
  manifestRaw: string | null;
  manifest: unknown;
  error: string | null;
  /** Files under theme.layouts, theme.assets and theme.static, relative to the theme directory. */
  layouts: string[];
  assets: string[];
  static: string[];
  /** A list was cut at the limit. */
  truncated: boolean;
  params: unknown;
}

export interface DataResponse {
  ref: PanelRef;
  commit: string;
  sources: DataSource[];
  /** Markdown files were not all read (the per-request limit). */
  truncated: boolean;
}

interface DataSourceBase {
  index: number;
  name: string | null;
  mode: string | null;
  collection: string | null;
}

export type DataSource =
  | (DataSourceBase & {
      type: "markdown";
      dir: string | null;
      fileCount: number;
      /** Front matter keys over all files of the source, most used first. */
      fields: { name: string; count: number }[];
      /** Files whose front matter could not be read. */
      invalid: string[];
      /** mode: data only: each file's front matter, for the table (plan 5.3). */
      items: { file: string; data: Record<string, unknown> }[];
      /** More files had front matter than `items` holds (the per-source limit). */
      itemsTruncated: boolean;
      dataIndex: { scopeField: string | null; keyField: string | null; valueField: string | null } | null;
    })
  /** Only the configuration: the MVP does not connect to Notion. */
  | (DataSourceBase & { type: "notion"; databaseId: string | null; cacheMode: string | null })
  | (DataSourceBase & { type: "other"; sourceType: string | null });
