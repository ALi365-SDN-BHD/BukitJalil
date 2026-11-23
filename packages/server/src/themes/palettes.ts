import { contrastRatio, parseHex, relativeLuminance, type TOKEN_CONTRACT } from "./design.ts";
import library from "./palettes.json" with { type: "json" };

/**
 * The palette library of the theme_palettes tool (plan 14, borrowing from taste skill, D4): palettes from
 * taste-skill (MIT, the notice is in palettes.json), filtered for BukitJalil, each filled in to the token
 * contract's colors with every contrast pair of the self-check met. Only lightness changes, never hue.
 */

export type ColorKey = (typeof TOKEN_CONTRACT.colors)[number];
export type SchemeColors = Record<ColorKey, string>;
export type Scheme = "light" | "dark";

export const TRADES = [
  "cafe",
  "bakery",
  "restaurant",
  "hotel",
  "wellness",
  "studio",
  "workshop",
  "wedding",
  "retail",
  "law",
  "clinic",
  "agency",
  "saas",
  "devtool",
  "fintech",
  "ai",
  "game",
  "hardware",
  "consumer-product",
] as const;
export type Trade = (typeof TRADES)[number];

export interface SourcePalette {
  id: string;
  name: string;
  scheme: Scheme;
  tags: string[];
  trades: string[];
  note: string;
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accentInk: string;
}

export interface Palette {
  id: string;
  name: string;
  scheme: Scheme;
  trades: string[];
  note: string;
  /** The token contract's colors: tokens.yaml `colors`. */
  colors: SchemeColors;
  /** A light palette's dark scheme, for the `prefers-color-scheme: dark` block. */
  darkScheme?: SchemeColors;
}

export const PALETTES: readonly SourcePalette[] = library.palettes as SourcePalette[];

/**
 * The code block keeps a dark background in both schemes, as in the default design system, whose code
 * highlighting colors are made for it: no lighter than the default's light-scheme code background.
 */
const CODE_BG_MAX = "#1f2226";
const CODE_TEXT = "#eceef0";

/** A palette filled in to the token contract, or null when a pair cannot be met by changing lightness. */
export function fillPalette(p: SourcePalette): Palette | null {
  const colors = schemeColors({
    bg: p.bg,
    surface: p.surface,
    text: p.ink,
    muted: p.muted,
    accent: p.accent,
    accentText: p.accentInk,
  });
  if (!colors) return null;
  const base = { id: p.id, name: p.name, scheme: p.scheme, trades: p.trades, note: p.note, colors };
  if (p.scheme === "dark") return base;
  const darkScheme = darkFrom(p);
  return darkScheme ? { ...base, darkScheme } : null;
}

/**
 * Up to `count` palettes of `scheme` (any when unset), those made for `trade` first, in random order, leaving
 * out the ids in `exclude`. `random` returns [0, 1), like Math.random.
 */
export function pickPalettes(
  opts: { trade?: Trade; scheme?: Scheme; exclude?: readonly string[]; count: number },
  random: () => number = Math.random,
): (Palette & { madeForTrade: boolean })[] {
  const skip = new Set(opts.exclude ?? []);
  const pool = PALETTES.filter((p) => !skip.has(p.id) && (opts.scheme === undefined || p.scheme === opts.scheme));
  const made = (p: SourcePalette) => opts.trade !== undefined && p.trades.includes(opts.trade);
  const ordered = [
    ...shuffle(pool.filter(made), random),
    ...shuffle(
      pool.filter((p) => !made(p)),
      random,
    ),
  ];
  const out: (Palette & { madeForTrade: boolean })[] = [];
  for (const p of ordered) {
    if (out.length >= opts.count) break;
    const filled = fillPalette(p);
    if (filled) out.push({ ...filled, madeForTrade: made(p) });
  }
  return out;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

interface Base {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
}

/** Fill one scheme in to the token contract, moving colors away from the background until each pair is met. */
function schemeColors(b: Base): SchemeColors | null {
  const grounds = [b.bg, b.surface];
  const light = (relativeLuminance(b.bg) ?? 0) > 0.18;
  const away = light ? "darker" : "lighter";
  const text = fit(b.text, grounds, 4.5, away);
  const muted = fit(b.muted, grounds, 4.5, away);
  const link = fit(b.accent, grounds, 4.5, away);
  if (!text || !muted || !link) return null;
  const accentText = [b.accentText, text, b.bg, "#ffffff", "#000000"].find(
    (c) => (contrastRatio(c, b.accent) ?? 0) >= 4.5,
  );
  const borderStrong = fit(mix(b.bg, text, 0.35), grounds, 3, away);
  const codeBg = light ? darkest(text, CODE_BG_MAX) : darkest(mix(b.bg, "#000000", 0.4), CODE_BG_MAX);
  const codeText = fit(light ? CODE_TEXT : text, [codeBg], 4.5, "lighter");
  if (!accentText || !borderStrong || !codeText) return null;
  return {
    bg: b.bg,
    surface: b.surface,
    text,
    muted,
    border: mix(b.bg, text, 0.15),
    "border-strong": borderStrong,
    accent: b.accent,
    "accent-text": accentText,
    link,
    focus: link,
    "code-bg": codeBg,
    "code-text": codeText,
  };
}

/** A light palette's dark scheme: dark grounds in the palette's own hue, its ground color as the text. */
function darkFrom(p: SourcePalette): SchemeColors | null {
  const [, c, h] = oklch(p.bg);
  const bg = fromOklch(0.2, Math.min(c, 0.015), h);
  const surface = fromOklch(0.245, Math.min(c, 0.015), h);
  const accent = fit(p.accent, [bg, surface], 4.5, "lighter");
  if (!accent) return null;
  return schemeColors({ bg, surface, text: p.bg, muted: p.muted, accent, accentText: bg });
}

function darkest(a: string, b: string): string {
  return (relativeLuminance(a) ?? 1) <= (relativeLuminance(b) ?? 1) ? a : b;
}

/**
 * `color` made darker or lighter in OKLCH (hue kept, chroma reduced only to stay in sRGB) until it has
 * `ratio` against every color in `against`; null when it cannot.
 */
export function fit(color: string, against: readonly string[], ratio: number, way: "darker" | "lighter") {
  const meets = (c: string) => against.every((g) => (contrastRatio(c, g) ?? 0) >= ratio);
  if (meets(color)) return color;
  const [l0, c, h] = oklch(color);
  const step = way === "darker" ? -0.005 : 0.005;
  for (let l = l0 + step; l >= 0 && l <= 1; l += step) {
    const next = fromOklch(l, c, h);
    if (meets(next)) return next;
  }
  return null;
}

/** `a` mixed with `t` of `b`, in sRGB. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a) ?? [0, 0, 0];
  const cb = parseHex(b) ?? [0, 0, 0];
  return hex(ca.map((v, i) => v + ((cb[i] as number) - v) * t) as [number, number, number]);
}

// --- OKLCH (Björn Ottosson's Oklab) ---

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** `[lightness, chroma, hue in degrees]` of a hex color. */
export function oklch(value: string): [number, number, number] {
  const [r, g, b] = (parseHex(value) ?? [0, 0, 0]).map((v) => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(B, A) * 180) / Math.PI;
  return [L, Math.hypot(A, B), hue < 0 ? hue + 360 : hue];
}

/** The hex color of an OKLCH color, chroma reduced until it fits in sRGB. */
export function fromOklch(l: number, c: number, h: number): string {
  let lo = 0;
  let hi = c;
  let rgb = linearRgb(l, c, h);
  if (!inGamut(rgb)) {
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(linearRgb(l, mid, h))) lo = mid;
      else hi = mid;
    }
    rgb = linearRgb(l, lo, h);
  }
  return hex(rgb.map((v) => toGamma(Math.min(1, Math.max(0, v))) * 255) as [number, number, number]);
}

function linearRgb(L: number, c: number, h: number): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

function hex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}
