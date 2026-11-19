import path from "node:path";
import { PAGE_TYPES, type ThemeCoverage, type ThemeToken } from "@bukitjalil/shared";
import { isRecord, pathProblem } from "../bukit/guard.ts";
import { parseYaml } from "../panels/yaml.ts";

/** Template and manifest files read for the coverage, each at most this many bytes. */
export const MAX_COVERAGE_FILE_BYTES = 256 * 1024;
const TEMPLATE_FILE = /\.html$/i;

/**
 * The files of one version of a project, as the coverage reads them: the AI's working copy through its gate
 * (theme_coverage) or a commit's tree (the theme panel). Paths are relative to the project root, with `/`.
 */
export interface ThemeFiles {
  /** Every regular file under `dir` (no symlinks). */
  list(dir: string): Promise<string[]>;
  /** The text of the files asked for; missing, unreadable or too large ones are left out. */
  read(paths: readonly string[]): Promise<Map<string, string>>;
}

/**
 * What a theme covers (theme development design 4.1, 2): the templates theme.yaml declares and whether their
 * files exist, the page types with no template, includes that point at missing files, and whether
 * tokens.yaml, the search page and static/404.html exist. Problems are reported, never thrown.
 */
export async function themeCoverage(
  config: Record<string, unknown>,
  themeName: string,
  files: ThemeFiles,
): Promise<ThemeCoverage> {
  const root = path.posix.join("themes", themeName);
  const theme = isRecord(config.theme) ? config.theme : {};
  const layouts = typeof theme.layouts === "string" && pathProblem(theme.layouts) === null ? theme.layouts : "layouts";
  const layoutsDir = path.posix.join(root, layouts);
  const all = new Set(await files.list(root));
  const exists = (rel: string) => all.has(rel);

  const manifestFile = path.posix.join(root, "theme.yaml");
  const templateFiles = [...all].filter((f) => f.startsWith(`${layoutsDir}/`) && TEMPLATE_FILE.test(f)).sort();
  const texts = await files.read([manifestFile, ...templateFiles]);
  const manifestText = texts.get(manifestFile);
  const manifest = manifestText === undefined ? null : parseYaml(manifestText);
  if (manifest === null || manifest.error !== null || !isRecord(manifest.value)) {
    return {
      theme: root,
      error: `${manifestFile} is missing or not valid YAML${manifest?.error ? `: ${manifest.error}` : ""}`,
    };
  }
  const declared = isRecord(manifest.value.templates) ? manifest.value.templates : {};
  const templates = Object.entries(declared).map(([pageType, entry]) => {
    const template = isRecord(entry) && typeof entry.template === "string" ? entry.template : null;
    const file = template !== null && pathProblem(template) === null ? path.posix.join(layoutsDir, template) : null;
    return { pageType, template, exists: file !== null && exists(file) };
  });
  const missingIncludes: { file: string; include: string }[] = [];
  for (const file of templateFiles) {
    const source = texts.get(file);
    if (source === undefined) continue;
    for (const match of source.matchAll(/\binclude\s+["']([^"']+)["']/g)) {
      const include = match[1] ?? "";
      const target = pathProblem(include) === null ? path.posix.join(layoutsDir, include) : null;
      if (target === null || !exists(target)) missingIncludes.push({ file, include });
    }
  }
  return {
    theme: root,
    layouts: layoutsDir,
    templates,
    missingPageTypes: PAGE_TYPES.filter((type) => !(type in declared)),
    missingTemplateFiles: templates.filter((t) => !t.exists).map((t) => t.template ?? t.pageType),
    missingIncludes,
    tokens: exists(path.posix.join(root, "tokens.yaml")),
    searchPage: exists(path.posix.join(layoutsDir, "pages", "search.html")),
    notFoundPage: exists(path.posix.join(root, "static", "404.html")),
  };
}

/** Hex, rgb()/hsl()/oklch() and the like, or a plain name: values safe to show as a swatch. */
const CSS_COLOR =
  /^(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([0-9.,%\s/+-]*\)|[a-zA-Z]{3,30})$/;
const MAX_TOKENS = 200;

/** The colors of a theme's tokens.yaml (`colors` group) for the theme panel's swatches; null without tokens. */
export function themeColors(tokensText: string | null): ThemeToken[] | null {
  if (tokensText === null) return null;
  const parsed = parseYaml(tokensText);
  const colors =
    parsed.error === null && isRecord(parsed.value) && isRecord(parsed.value.colors) ? parsed.value.colors : {};
  const out: ThemeToken[] = [];
  const walk = (prefix: string, group: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(group)) {
      if (out.length >= MAX_TOKENS) return;
      const name = prefix ? `${prefix}.${key}` : key;
      if (isRecord(value)) walk(name, value);
      else if (typeof value === "string" && CSS_COLOR.test(value.trim())) out.push({ name, value: value.trim() });
    }
  };
  walk("", colors);
  return out;
}
