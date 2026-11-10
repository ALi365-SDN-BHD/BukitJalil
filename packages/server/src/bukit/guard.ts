import { parseDocument } from "yaml";
import { listTree, readBlob, SYMLINK_MODE, type TreeEntry } from "../git/objects.ts";
import { GitError, type GitRunner } from "../git/run.ts";

/**
 * Pre-build safety check (plan 8.5), run before every Bukit call on a commit. It reads git objects, not a
 * working tree, so it can run before any checkout exists and judges exactly what will be built.
 */

export type GuardReasonCode =
  | "missing_site_yaml"
  | "invalid_site_yaml"
  | "symlink"
  | "plugin_files"
  | "unknown_plugin"
  | "unsafe_path"
  | "unsafe_route"
  | "private_network_allowed"
  | "lfs"
  | "case_collision";

export interface GuardReason {
  code: GuardReasonCode;
  /** File path in the tree, or the site.yaml field (e.g. "theme.layouts"). */
  where?: string;
  detail?: string;
}

export interface GuardResult {
  ok: boolean;
  reasons: GuardReason[];
  /** Uses a Notion source: Bukit needs NOTION_TOKEN for check/doctor/build (plan 5.1). */
  usesNotion: boolean;
}

/** Built-in plugin switches of `site.plugins` (plan 8.5); they never start a process. */
export const BUILTIN_PLUGINS = new Set([
  "alias",
  "analytics",
  "archive",
  "data-files",
  "feed",
  "image-processing",
  "responsive-images",
  "llms-txt",
  "menu",
  "pages-index",
  "pagination",
  "related-content",
  "search-index",
  "sitemap",
  "taxonomy",
]);

/**
 * site.yaml fields that are files or directories in the checkout (from `bukit config schema` 2.0.11).
 * `*` is a map key, `[]` an array item. Values must be relative paths without "..".
 */
export const PATH_FIELDS = [
  "content.media.downloadDir",
  "content.sources[].markdown.dir",
  "content.sources[].markdown.includePaths[]",
  "content.sources[].markdown.includeGlobs[]",
  "content.sources[].notion.cacheDir",
  "build.output",
  "theme.name",
  "theme.layouts",
  "theme.assets",
  "theme.static",
  "theme.staticTemplate",
  "theme.shortcodes.*",
  "theme.components.*.template",
  "theme.scss.entryPoint",
  "theme.scss.outputDir",
  "site.collections.*.template",
  "site.collections.*.listTemplate",
  "site.collections.*.output.archiveDetail.template",
  "site.collections.*.filteredLists[].listTemplate",
  "taxonomy.kinds[].template",
  "taxonomy.kinds[].indexTemplate",
  "taxonomy.kinds[].termTemplate",
];

/**
 * Output routes: written below the output directory. A leading "/" is normal; ".." would write outside it.
 */
export const ROUTE_FIELDS = [
  "site.permalinks.*",
  "site.feed.path",
  "site.search.route",
  "site.collections.*.permalink",
  "site.collections.*.listRoute",
  "site.collections.*.pagination.urlPattern",
  "site.collections.*.output.feedPath",
  "site.collections.*.output.archiveDetail.routePrefix",
  "site.collections.*.filteredLists[].listRoute",
  "site.collections.*.filteredLists[].urlPattern",
  "taxonomy.kinds[].routePrefix",
];

const MAX_SITE_YAML = 1024 * 1024;

const MAX_GITATTRIBUTES = 256 * 1024;

export async function guardCommit(git: GitRunner, repo: string, commit: string): Promise<GuardResult> {
  const reasons: GuardReason[] = [];
  const entries = await listTree(git, repo, commit, { recursive: true });

  // Checkouts on macOS (APFS) and Windows are case-insensitive: Bukit opening "plugins/x/plugin.yaml" or
  // "site.yaml" also gets "Plugins/x/PLUGIN.YAML" or "SITE.yaml". So names are compared in lower case, and
  // paths that differ only in case are refused, because which one lands on disk depends on checkout order.
  const seen = new Map<string, string>();
  for (const e of entries) {
    const lower = e.path.toLowerCase();
    const other = seen.get(lower);
    if (other !== undefined) reasons.push({ code: "case_collision", where: e.path, detail: other });
    seen.set(lower, e.path);
    if (e.mode === SYMLINK_MODE) reasons.push({ code: "symlink", where: e.path });
    const name = lower.slice(lower.lastIndexOf("/") + 1);
    if (lower === ".bukit/plugins.yaml" || lower.startsWith("plugins/") || name === "plugin.yaml") {
      reasons.push({ code: "plugin_files", where: e.path });
    }
  }
  reasons.push(...(await checkLfs(git, repo, entries)));

  // Only the exact name counts; a "Site.yaml" alone is reported missing, and a second spelling next to
  // "site.yaml" was reported as a case collision above.
  const site = entries.find((e) => e.path === "site.yaml");
  if (!site || site.type !== "blob" || site.mode === SYMLINK_MODE) {
    reasons.push({ code: "missing_site_yaml", where: "site.yaml" });
    return { ok: false, reasons, usesNotion: false };
  }
  const raw = await readLimited(git, repo, site, MAX_SITE_YAML);
  if (raw === null) {
    reasons.push({ code: "invalid_site_yaml", where: "site.yaml", detail: `larger than ${MAX_SITE_YAML} bytes` });
    return { ok: false, reasons, usesNotion: false };
  }
  const result = checkSiteConfig(raw.toString("utf8"));
  reasons.push(...result.reasons);
  return { ok: reasons.length === 0, reasons, usesNotion: result.usesNotion };
}

/** A blob from the listing, or null when it is larger than `maxBytes`. Other git errors are thrown. */
async function readLimited(git: GitRunner, repo: string, entry: TreeEntry, maxBytes: number): Promise<Buffer | null> {
  if (entry.size !== null && entry.size > maxBytes) return null;
  try {
    return await readBlob(git, repo, entry.oid, maxBytes);
  } catch (err) {
    if (err instanceof GitError && err.kind === "output_too_large") return null;
    throw err;
  }
}

/** The site.yaml part of the guard; exported for unit tests. */
export function checkSiteConfig(text: string): { reasons: GuardReason[]; usesNotion: boolean } {
  // Bukit (YamlDotNet's node model) sees every scalar as its raw text and converts it itself, e.g. bool via
  // .NET bool.TryParse, which also accepts a quoted "false". The failsafe schema keeps every value as text
  // too, so the guard judges the same values Bukit will use.
  const doc = parseDocument(text, { schema: "failsafe", uniqueKeys: true });
  if (doc.errors.length > 0) {
    return { reasons: [{ code: "invalid_site_yaml", detail: doc.errors[0]?.message }], usesNotion: false };
  }
  const config: unknown = doc.toJS({ maxAliasCount: 100 });
  if (!isRecord(config))
    return { reasons: [{ code: "invalid_site_yaml", detail: "not a mapping" }], usesNotion: false };

  const reasons: GuardReason[] = [];
  for (const field of PATH_FIELDS) {
    for (const [where, value] of valuesAt(config, field)) {
      if (typeof value !== "string") continue; // Bukit rejects wrong types itself
      const problem = pathProblem(value, field === "theme.name");
      if (problem) reasons.push({ code: "unsafe_path", where, detail: problem });
    }
  }
  for (const field of ROUTE_FIELDS) {
    for (const [where, value] of valuesAt(config, field)) {
      if (typeof value === "string" && routeProblem(value)) {
        reasons.push({ code: "unsafe_route", where, detail: routeProblem(value) ?? undefined });
      }
    }
  }

  const plugins = isRecord(config.site) ? config.site.plugins : undefined;
  if (isRecord(plugins)) {
    for (const name of Object.keys(plugins)) {
      if (!BUILTIN_PLUGINS.has(name)) reasons.push({ code: "unknown_plugin", where: `site.plugins.${name}` });
    }
  }

  const media = isRecord(config.content) && isRecord(config.content.media) ? config.content.media : null;
  if (typeof media?.blockPrivateNetworks === "string" && media.blockPrivateNetworks.trim().toLowerCase() === "false") {
    reasons.push({ code: "private_network_allowed", where: "content.media.blockPrivateNetworks" });
  }

  const sources = isRecord(config.content) && Array.isArray(config.content.sources) ? config.content.sources : [];
  const usesNotion = sources.some((s) => isRecord(s) && (s.type === "notion" || isRecord(s.notion)));
  return { reasons, usesNotion };
}

/** Why a path value is unsafe, or null. `singleName` for theme.name, which names one directory. */
export function pathProblem(value: string, singleName = false): string | null {
  if (value.includes("\0")) return "contains NUL";
  if (value.includes("\\")) return "contains a backslash";
  if (value.startsWith("/") || value.startsWith("~") || /^[a-zA-Z]:/.test(value)) return "absolute path";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return "URL";
  if (value.split("/").some((s) => s === "..")) return "contains ..";
  if (singleName && value.includes("/")) return "must be a single directory name";
  return null;
}

export function routeProblem(value: string): string | null {
  if (value.includes("\0")) return "contains NUL";
  if (value.includes("\\")) return "contains a backslash";
  if (value.split("/").some((s) => s === "..")) return "contains ..";
  return null;
}

/** Values at a field path like "content.sources[].markdown.dir", with their concrete location. */
function valuesAt(root: unknown, field: string): [string, unknown][] {
  const steps = field.split(".").flatMap((part) => (part.endsWith("[]") ? [part.slice(0, -2), "[]"] : [part]));
  let current: [string, unknown][] = [["", root]];
  for (const step of steps) {
    const next: [string, unknown][] = [];
    for (const [where, node] of current) {
      if (step === "[]") {
        if (Array.isArray(node)) for (const [i, item] of node.entries()) next.push([`${where}[${i}]`, item]);
      } else if (step === "*") {
        if (isRecord(node)) for (const [k, v] of Object.entries(node)) next.push([join(where, k), v]);
      } else if (isRecord(node) && step in node) {
        next.push([join(where, step), node[step]]);
      }
    }
    current = next;
  }
  return current;
}

const join = (where: string, key: string) => (where ? `${where}.${key}` : key);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Git LFS is not supported (plan 7.3): any tracked .gitattributes with a filter attribute. A file too
 * large to check is refused as well, so the check never passes on content it did not read.
 */
async function checkLfs(git: GitRunner, repo: string, entries: TreeEntry[]): Promise<GuardReason[]> {
  for (const e of entries) {
    const lower = e.path.toLowerCase();
    if (e.type !== "blob" || (lower !== ".gitattributes" && !lower.endsWith("/.gitattributes"))) continue;
    const blob = await readLimited(git, repo, e, MAX_GITATTRIBUTES);
    if (blob === null) return [{ code: "lfs", where: e.path, detail: `larger than ${MAX_GITATTRIBUTES} bytes` }];
    if (hasFilterAttribute(blob.toString("utf8"))) return [{ code: "lfs", where: e.path }];
  }
  return [];
}

/** A `filter=<driver>` attribute outside comment lines. */
export function hasFilterAttribute(text: string): boolean {
  return text.split("\n").some((line) => !line.trimStart().startsWith("#") && /(^|\s)filter=/.test(line));
}
