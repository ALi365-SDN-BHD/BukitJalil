import { isRecord } from "../bukit/guard.ts";

/**
 * The token contract of the theme-design skill (plan 14, theme design spec Q1) and the color arithmetic the
 * design checks need. Bukit writes `tokens.yaml` key `group.key` as the CSS variable `--<prefix>-<key>`.
 */

/** Keys every theme's tokens.yaml must define, by group. */
export const TOKEN_CONTRACT = {
  colors: [
    "bg",
    "surface",
    "text",
    "muted",
    "border",
    "border-strong",
    "accent",
    "accent-text",
    "link",
    "focus",
    "code-bg",
    "code-text",
  ],
  font: [
    "body",
    "heading",
    "mono",
    "size-sm",
    "size-base",
    "size-lg",
    "size-xl",
    "size-2xl",
    "size-3xl",
    "leading-body",
    "leading-heading",
  ],
  spacing: ["1", "2", "3", "4", "5", "6", "7", "8"],
  radius: ["sm", "md", "lg"],
  layout: ["content", "wide"],
} as const;

export type TokenGroup = keyof typeof TOKEN_CONTRACT;

/** The `group.key` names of the contract that `tokens` (a parsed tokens.yaml) lacks. */
export function missingTokens(tokens: unknown): string[] {
  const root = isRecord(tokens) ? tokens : {};
  return Object.entries(TOKEN_CONTRACT).flatMap(([group, keys]) => {
    const values = root[group];
    return keys.filter((key) => !isRecord(values) || !(key in values)).map((key) => `${group}.${key}`);
  });
}

/** An sRGB color from `#rgb` or `#rrggbb`, or null for anything else (names, functions, variables). */
export function parseHex(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2 contrast ratio of two hex colors, or null when either is not a hex color. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return null;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2 relative luminance of a hex color, or null when it is not one. */
export function relativeLuminance(value: string): number | null {
  const rgb = parseHex(value);
  return rgb ? luminance(rgb) : null;
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The colors a stylesheet's dark scheme sets for the contract's `--color-*` variables, by key (`bg`, …): the
 * declarations inside `@media (prefers-color-scheme: dark)` blocks, comments removed.
 */
export function darkSchemeColors(css: string): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const block of mediaBlocks(stripComments(css), /prefers-color-scheme\s*:\s*dark/i)) {
    for (const m of block.matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;}]+)/gi)) {
      colors[(m[1] as string).toLowerCase()] = (m[2] as string).trim();
    }
  }
  return colors;
}

/**
 * `css` with its comments replaced by spaces (newlines kept, so offsets and line numbers stay right). An
 * unclosed comment runs to the end. One linear scan: a regex would retry every unclosed `/*` to the end.
 */
export function stripComments(css: string): string {
  let out = "";
  let from = 0;
  for (let open = css.indexOf("/*"); open >= 0; open = css.indexOf("/*", from)) {
    const close = css.indexOf("*/", open + 2);
    const end = close < 0 ? css.length : close + 2;
    out += css.slice(from, open) + css.slice(open, end).replace(/[^\n]/g, " ");
    from = end;
  }
  return out + css.slice(from);
}

/** The bodies of the `@media` blocks whose condition matches `condition`, braces balanced. */
export function mediaBlocks(css: string, condition: RegExp): string[] {
  return mediaSpans(css, condition).map(([, , start, end]) => css.slice(start, end));
}

/**
 * Where the `@media` blocks whose condition matches `condition` are: `[start, end, bodyStart, bodyEnd]`, from
 * `@media` to past the closing brace, braces balanced.
 */
export function mediaSpans(css: string, condition: RegExp): [number, number, number, number][] {
  const spans: [number, number, number, number][] = [];
  // Blocks inside a block already found are part of it, so each character is scanned once: the condition is
  // bounded, and an unclosed block (running to the end) is not scanned again for every `@media` after it.
  let covered = 0;
  for (const m of css.matchAll(/@media([^{};]{0,1000})\{/g)) {
    if ((m.index as number) < covered || !condition.test(m[1] as string)) continue;
    const start = (m.index as number) + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    spans.push([m.index as number, i, start, depth === 0 ? i - 1 : i]);
    covered = i;
  }
  return spans;
}
