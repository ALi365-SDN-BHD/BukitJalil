import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseYaml } from "../src/panels/yaml.ts";
import { applyDesignSystem, makeThemeProject } from "../src/themes/demo.ts";
import { contrastRatio, darkSchemeColors, missingTokens, TOKEN_CONTRACT } from "../src/themes/design.ts";
import { writeStarter } from "./fixtures/starter.ts";

const DEMO = path.join(import.meta.dirname, "..", "assets", "theme-demo");
const SYSTEM = path.join(DEMO, "design-system");

const tokens = parseYaml(fs.readFileSync(path.join(SYSTEM, "tokens.yaml"), "utf8")).value as {
  colors: Record<string, string>;
};
const css = fs.readFileSync(path.join(SYSTEM, "style.css"), "utf8");

/** Text and background pairs of the design self-check (group 2), with the ratio each needs. */
const PAIRS: [string, string, number][] = [
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

describe("the default design system (theme design spec D1)", () => {
  it("defines every key of the token contract", () => {
    expect(missingTokens(tokens)).toEqual([]);
    expect(missingTokens({ colors: { bg: "#fff" } })).toContain("colors.surface");
    expect(missingTokens(null)).toHaveLength(Object.values(TOKEN_CONTRACT).flat().length);
  });

  it("passes the contrast checks in the light and the dark scheme", () => {
    const dark = { ...tokens.colors, ...darkSchemeColors(css) };
    expect(Object.keys(darkSchemeColors(css)).sort()).toEqual([...TOKEN_CONTRACT.colors].sort());
    for (const scheme of [tokens.colors, dark]) {
      for (const [fg, bg, min] of PAIRS) {
        const ratio = contrastRatio(scheme[fg] as string, scheme[bg] as string);
        expect(ratio, `${fg} on ${bg}`).not.toBeNull();
        expect(ratio as number, `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it("uses only token variables for theme values, outside the dark scheme and the content palettes", () => {
    const palettes = css.indexOf("/* Content palettes");
    expect(palettes).toBeGreaterThan(0);
    const themeRules = css
      .slice(0, palettes)
      .replace(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}\n/, "")
      .replace(/@media print \{[\s\S]*?\n\}\n/, "");
    expect(themeRules.match(/#[0-9a-f]{3,6}\b/gi)).toBeNull();
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(":focus-visible");
    expect(css).not.toMatch(/https?:\/\//);
  });

  it("goes into a new theme: tokens, stylesheet and the token link before the theme's own", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bj-design-"));
    const site = path.join(dir, "site");
    writeStarter(site, { title: "Aurora", language: "en-US" });
    makeThemeProject(site, { name: "aurora", displayName: "Aurora" }, DEMO);
    const theme = path.join(site, "themes", "aurora");
    expect(fs.readFileSync(path.join(theme, "tokens.yaml"), "utf8")).toBe(
      fs.readFileSync(path.join(SYSTEM, "tokens.yaml"), "utf8"),
    );
    expect(fs.readFileSync(path.join(theme, "assets", "style.css"), "utf8")).toBe(css);
    const base = fs.readFileSync(path.join(theme, "layouts", "layouts", "base.html"), "utf8");
    const tokensLink = base.indexOf('href="{{ asset_base_url }}/assets/css/theme-tokens.css"');
    expect(tokensLink).toBeGreaterThan(0);
    expect(tokensLink).toBeLessThan(base.indexOf('href="{{ asset_base_url }}/assets/style.css"'));
    expect(base.match(/theme-tokens\.css/g)).toHaveLength(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a starter whose base layout lost the stylesheet link", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bj-design-"));
    const site = path.join(dir, "site");
    writeStarter(site, { title: "Aurora", language: "en-US" });
    const theme = path.join(site, "themes", "starter");
    fs.writeFileSync(path.join(theme, "layouts", "layouts", "base.html"), "<html><head></head></html>");
    expect(() => applyDesignSystem(theme, DEMO)).toThrow(/no stylesheet link/);
    expect(fs.existsSync(path.join(theme, "tokens.yaml"))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
