import type { ThemeLintIssue, ThemeLintRule } from "@bukitjalil/shared";
import { isRecord } from "../bukit/guard.ts";
import { parseYaml } from "../panels/yaml.ts";
import type { ThemeFiles } from "./coverage.ts";
import { contrastRatio, darkSchemeColors, mediaSpans, missingTokens } from "./design.ts";

/**
 * The checks of the theme-design self-check a program can make (plan 14, theme design spec D2): the token
 * contract, contrast in both schemes, literal colors, outside resources, focus styles, motion and the clear
 * signs of an AI look. The rest of the self-check stays the AI's job. Issues are warnings, never errors.
 */

/** Files the lint reads, by path relative to the theme directory. */
export const LINT_FILE = /^(tokens\.yaml|assets\/.+\.css|layouts\/.+\.html|static\/.+\.html)$/i;

/** Text and background pairs of the self-check (group 2), with the ratio each needs. */
const CONTRAST_PAIRS: [string, string, number][] = [
  ["text", "bg", 4.5],
  ["text", "surface", 4.5],
  ["muted", "bg", 4.5],
  ["muted", "surface", 4.5],
  ["link", "bg", 4.5],
  ["link", "surface", 4.5],
  ["accent-text", "accent", 4.5],
  ["code-text", "code-bg", 4.5],
  ["focus", "bg", 3],
];

/** Rules whose selector names a content palette (Notion colors, code highlighting) may keep literal colors. */
const PALETTE_SELECTOR = /\.(notion-|hljs)|\.token(?![\w-])/;
const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|lab|lch)\(/gi;
/** Elements that load a resource; links (`<a href>`) to other sites are fine. */
const RESOURCE_TAG =
  /<(script|link|img|source|iframe|video|audio)\b[^>]*?\s(src|href|srcset)\s*=\s*["']?\s*(https?:)?\/\//gi;
const CSS_REMOTE = /url\(\s*["']?\s*(https?:)?\/\/|@import\s+(url\()?\s*["']?\s*(https?:)?\/\//gi;
/**
 * Emoji: characters shown as emoji by default, or a pictograph followed by the emoji variation selector. Text
 * symbols such as ©, ™, arrows, ☰ and ★ are not emoji.
 */
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u;
const MAX_LINES_LISTED = 5;

/** Lint the theme in `themeDir` (`themes/<name>`) of a version's files; issue paths are relative to `themeDir`. */
export async function lintThemeFiles(themeDir: string, files: ThemeFiles): Promise<ThemeLintIssue[]> {
  const prefix = `${themeDir}/`;
  const paths = (await files.list(themeDir)).filter(
    (p) => p.startsWith(prefix) && LINT_FILE.test(p.slice(prefix.length)),
  );
  const texts = await files.read(paths);
  return lintTheme(new Map([...texts].map(([p, text]) => [p.slice(prefix.length), text])));
}

/** Lint a theme's files (paths relative to the theme directory, see LINT_FILE). */
export function lintTheme(files: ReadonlyMap<string, string>): ThemeLintIssue[] {
  const issues: ThemeLintIssue[] = [];
  const add = (rule: ThemeLintRule, file: string | null, line: number | null, detail: string) =>
    issues.push({ rule, file, line, detail });

  const tokensText = files.get("tokens.yaml");
  const tokens = tokensText === undefined ? null : parseYaml(tokensText).value;
  const missing = missingTokens(tokens);
  if (tokensText === undefined)
    add("tokens_missing", null, null, "The theme has no tokens.yaml (or it is over 256 KiB).");
  else if (missing.length > 0) add("tokens_missing", "tokens.yaml", null, `Missing keys: ${missing.join(", ")}.`);

  // Comments are blanked out, keeping line numbers.
  const sheets = [...files]
    .filter(([p]) => /\.css$/i.test(p))
    .map(([p, css]) => [p, blank(css, /\/\*[\s\S]*?\*\//g)] as const);
  const templates = [...files].filter(([p]) => /\.html$/i.test(p));
  const allCss = sheets.map(([, css]) => css).join("\n");

  const light = colorsOf(tokens);
  const darkOverrides = darkSchemeColors(allCss);
  checkContrast(light, "light", add);
  if (Object.keys(darkOverrides).length > 0) checkContrast({ ...light, ...darkOverrides }, "dark", add);

  const anyFocusVisible = /:focus-visible/.test(allCss);
  // One reduced-motion block (usually on `*`) covers every stylesheet of the theme.
  const anyReducedMotion = /prefers-reduced-motion\s*:\s*reduce/i.test(allCss);
  for (const [file, css] of sheets) {
    const lines = (re: RegExp) => lineNumbers(css, re, lineStarts(css));
    const at = (re: RegExp) => lines(re)[0] ?? null;

    const literal = literalColorLines(css);
    if (literal.length > 0)
      add(
        "literal_color",
        file,
        literal[0] ?? null,
        `Literal colors instead of --color-* variables on ${listed(literal)}.`,
      );
    const remote = lines(CSS_REMOTE);
    if (remote.length > 0)
      add("external_resource", file, remote[0] ?? null, `Loads a resource from another site on ${listed(remote)}.`);
    const noOutline = lines(/outline\s*:\s*(none|0)(?![\w.%])/gi);
    if (noOutline.length > 0 && !anyFocusVisible)
      add(
        "focus_visible",
        file,
        noOutline[0] ?? null,
        "Removes the outline, and no stylesheet has a :focus-visible style.",
      );
    const motion = lines(/(^|[;{\s])(transition|animation)(-[a-z-]+)?\s*:(?!\s*none\b)/gim);
    if (motion.length > 0 && !anyReducedMotion)
      add(
        "reduced_motion",
        file,
        motion[0] ?? null,
        "Has transitions or animations, and no stylesheet has a @media (prefers-reduced-motion: reduce) block.",
      );
    const all = at(/transition(-property)?\s*:\s*all\b/gi);
    if (all !== null) add("transition_all", file, all, "Uses transition: all; name the properties.");
    const clip = at(/background-clip\s*:\s*text\b/gi);
    if (clip !== null) add("gradient_text", file, clip, "Clips a background to text (gradient text).");
    const glass = at(/backdrop-filter\s*:(?!\s*none\b)/gi);
    if (glass !== null) add("frosted_glass", file, glass, "Uses backdrop-filter (frosted glass).");
  }
  if (sheets.length > 0 && !anyFocusVisible && !issues.some((i) => i.rule === "focus_visible"))
    add("focus_visible", null, null, "No stylesheet has a :focus-visible style for links, buttons and inputs.");

  for (const [file, html] of templates) {
    const remote = lineNumbers(html, RESOURCE_TAG, lineStarts(html));
    if (remote.length > 0)
      add("external_resource", file, remote[0] ?? null, `Loads a resource from another site on ${listed(remote)}.`);
    const emoji = html.split("\n").findIndex((l) => EMOJI.test(l));
    if (emoji >= 0) add("emoji", file, emoji + 1, "Uses emoji, which the theme-design skill does not allow as icons.");
  }
  return issues;
}

type Add = (rule: ThemeLintRule, file: string | null, line: number | null, detail: string) => void;

function checkContrast(colors: Record<string, string>, scheme: "light" | "dark", add: Add): void {
  for (const [fg, bg, min] of CONTRAST_PAIRS) {
    const a = colors[fg];
    const b = colors[bg];
    if (a === undefined || b === undefined) continue;
    const ratio = contrastRatio(a, b);
    // Colors that are not hex (names, functions, variables) cannot be worked out here.
    if (ratio !== null && ratio < min)
      add(
        "contrast",
        null,
        null,
        `${scheme} scheme: ${fg} ${a} on ${bg} ${b} is ${ratio.toFixed(2)}:1, needs ${min}:1.`,
      );
  }
}

function colorsOf(tokens: unknown): Record<string, string> {
  const colors = isRecord(tokens) ? tokens.colors : null;
  if (!isRecord(colors)) return {};
  return Object.fromEntries(Object.entries(colors).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/** Lines with literal colors outside the dark scheme, print and content palette rules (comments already blank). */
function literalColorLines(css: string): number[] {
  let text = css;
  // `print` alone or in a list (`screen, print`), not `not print`, which is every other medium.
  for (const condition of [/prefers-color-scheme\s*:\s*dark/i, /(^|,)\s*(only\s+)?print\s*(,|$|and\b)/i]) {
    for (const [start, end] of mediaSpans(text, condition))
      text = text.slice(0, start) + spaces(text.slice(start, end)) + text.slice(end);
  }
  const starts = lineStarts(text);
  const out = new Set<number>();
  for (const rule of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = rule[1] as string;
    if (PALETTE_SELECTOR.test(selector) || /@font-face/i.test(selector)) continue;
    const bodyStart = (rule.index as number) + selector.length + 1;
    for (const m of (rule[2] as string).matchAll(LITERAL_COLOR))
      out.add(lineAt(starts, bodyStart + (m.index as number)));
  }
  return [...out].sort((a, b) => a - b);
}

/** The 1-based lines where `re` (global) matches; `starts` from lineStarts(text). */
function lineNumbers(text: string, re: RegExp, starts: number[]): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(re)) out.add(lineAt(starts, m.index as number));
  return [...out].sort((a, b) => a - b);
}

/** Where each line of `text` starts. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

/** The 1-based line of `index`: binary search for the last line start at or before it. */
function lineAt(starts: number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** `text` with every match of `re` replaced by spaces, keeping newlines so line numbers stay right. */
function blank(text: string, re: RegExp): string {
  return text.replace(re, spaces);
}

function spaces(s: string): string {
  return s.replace(/[^\n]/g, " ");
}

function listed(lines: number[]): string {
  const shown = lines.slice(0, MAX_LINES_LISTED).join(", ");
  const more = lines.length - MAX_LINES_LISTED;
  return `${lines.length === 1 ? "line" : "lines"} ${shown}${more > 0 ? ` and ${more} more` : ""}`;
}
