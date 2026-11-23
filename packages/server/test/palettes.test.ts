import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, TOKEN_CONTRACT } from "../src/themes/design.ts";
import { lintTheme } from "../src/themes/lint.ts";
import library from "../src/themes/palettes.json" with { type: "json" };
import { fillPalette, oklch, PALETTES, pickPalettes, type SchemeColors, TRADES } from "../src/themes/palettes.ts";

const SYSTEM = path.join(import.meta.dirname, "..", "assets", "theme-demo", "design-system");
const tokensYaml = fs.readFileSync(path.join(SYSTEM, "tokens.yaml"), "utf8");
const css = fs.readFileSync(path.join(SYSTEM, "style.css"), "utf8");
/** The default design system's dark block of `--color-*` variables, the first in the stylesheet. */
const DARK_BLOCK = /@media \(prefers-color-scheme: dark\) \{\n {2}:root \{\n[^}]*\}\n\}\n/;

/** The default design system with a palette's colors: tokens, and the dark block set or removed. */
function themeWith(colors: SchemeColors, dark: SchemeColors | undefined): Map<string, string> {
  let tokens = tokensYaml;
  for (const [key, value] of Object.entries(colors)) {
    tokens = tokens.replace(new RegExp(`^( {2}${key}: )"#[0-9a-f]+"$`, "m"), `$1"${value}"`);
  }
  let sheet = css;
  if (dark) {
    sheet = sheet.replace(DARK_BLOCK, (block) =>
      Object.entries(dark).reduce(
        (b, [key, value]) => b.replace(new RegExp(`(--color-${key}: )#[0-9a-f]+;`), `$1${value};`),
        block,
      ),
    );
  } else sheet = sheet.replace(DARK_BLOCK, "");
  // The substitutions really happened, so a clean lint is about the palette.
  expect(tokens).toContain(`  muted: "${colors.muted}"`);
  expect(sheet).not.toBe(css);
  if (dark) expect(sheet).toContain(`--color-muted: ${dark.muted};`);
  return new Map([
    ["tokens.yaml", tokens],
    ["assets/style.css", sheet],
  ]);
}

/** A seeded random number generator, so picks repeat. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

describe("the palette library (borrowing from taste skill, D4)", () => {
  it("carries the taste-skill MIT notice and its source", () => {
    expect(library.license).toMatch(/^MIT License\n\nCopyright \(c\) 2026 Leonxlnx/);
    expect(library.license).toContain("The above copyright notice and this permission notice shall be included");
    expect(library.source).toContain("github.com/Leonxlnx/taste-skill/blob/6c0b5c7/");
  });

  it("keeps only palettes that pass BukitJalil's filter (Q11)", () => {
    expect(PALETTES.length).toBe(42);
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
    for (const p of PALETTES) {
      const [bl, bc, bh] = oklch(p.bg);
      const [, ac, ah] = oklch(p.accent);
      expect(p.scheme, p.id).toBe(bl < 0.5 ? "dark" : "light");
      expect(p.tags, p.id).not.toContain("flat-loud");
      expect(bc, `${p.id}: ground nearly without color`).toBeLessThan(0.045);
      expect(ac > 0.05 && ah > 275 && ah < 330, `${p.id}: violet accent`).toBe(false);
      const vivid = ac > 0.15 && ((ah > 120 && ah < 160) || (ah > 20 && ah < 45));
      expect(bl < 0.25 && vivid, `${p.id}: near-black with one vivid accent`).toBe(false);
      const cream = bl > 0.9 && bh > 60 && bh < 100 && bc > 0.01;
      expect(cream && ac > 0.08 && ah > 30 && ah < 60, `${p.id}: warm cream with terracotta`).toBe(false);
      expect(contrastRatio(p.accentInk, p.accent), p.id).toBeGreaterThanOrEqual(4.5);
      for (const t of p.trades) expect(TRADES, p.id).toContain(t);
      expect(p.note, p.id).not.toMatch(/section 0|deal/);
    }
  });

  it("fills every palette in to the token contract, so the default design system with it lints clean", () => {
    for (const p of PALETTES) {
      const filled = fillPalette(p);
      expect(filled, p.id).not.toBeNull();
      if (!filled) continue;
      expect(Object.keys(filled.colors).sort()).toEqual([...TOKEN_CONTRACT.colors].sort());
      expect(Boolean(filled.darkScheme), p.id).toBe(p.scheme === "light");
      // Hue is kept: the palette's own grounds, text and accent stay as they are in its scheme.
      expect([filled.colors.bg, filled.colors.surface, filled.colors.accent]).toEqual([p.bg, p.surface, p.accent]);
      expect(lintTheme(themeWith(filled.colors, filled.darkScheme)), p.id).toEqual([]);
    }
  });

  it("keeps the code block dark enough for the default design system's highlighting colors", () => {
    const palette = css.slice(css.indexOf("/* Content palettes"), css.indexOf(".notion-gray"));
    const highlight = [...palette.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0]);
    expect(highlight.length).toBeGreaterThan(5);
    for (const p of PALETTES) {
      const filled = fillPalette(p);
      for (const scheme of [filled?.colors, filled?.darkScheme].filter((s) => s !== undefined)) {
        for (const color of highlight) {
          expect(contrastRatio(color, scheme["code-bg"]), `${p.id} ${color}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("picks three, those made for the trade first, in the scheme asked for, leaving out the excluded", () => {
    const first = pickPalettes({ trade: "cafe", count: 3 }, seeded(1));
    expect(first).toHaveLength(3);
    expect(first.every((p) => p.madeForTrade && p.trades.includes("cafe"))).toBe(true);
    expect(pickPalettes({ trade: "cafe", count: 3 }, seeded(1)).map((p) => p.id)).toEqual(first.map((p) => p.id));

    const next = pickPalettes({ trade: "cafe", count: 3, exclude: first.map((p) => p.id) }, seeded(1));
    expect(next.some((p) => first.some((f) => f.id === p.id))).toBe(false);

    const dark = pickPalettes({ scheme: "dark", count: 3 }, seeded(2));
    expect(dark.every((p) => p.scheme === "dark" && p.darkScheme === undefined && !p.madeForTrade)).toBe(true);

    // Fewer palettes made for the trade than asked for: the rest come from other trades, after them.
    const law = PALETTES.filter((p) => p.scheme === "dark" && p.trades.includes("law")).length;
    const mixed = pickPalettes({ trade: "law", scheme: "dark", count: law + 2 }, seeded(3));
    expect(mixed.map((p) => p.madeForTrade)).toEqual([...Array(law).fill(true), false, false]);

    expect(pickPalettes({ count: 3, exclude: PALETTES.map((p) => p.id) })).toEqual([]);
  });
});
