import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseYaml } from "../src/panels/yaml.ts";
import { applyDesignSystem, makeThemeProject } from "../src/themes/demo.ts";
import { contrastRatio, darkSchemeColors, missingTokens, TOKEN_CONTRACT } from "../src/themes/design.ts";
import { lintTheme, lintThemeFiles } from "../src/themes/lint.ts";
import { writeStarter } from "./fixtures/starter.ts";

const DEMO = path.join(import.meta.dirname, "..", "assets", "theme-demo");
const SYSTEM = path.join(DEMO, "design-system");
const MATERIAL = path.join(DEMO, "design-system-material");

const read = (dir: string) => ({
  tokens: parseYaml(fs.readFileSync(path.join(dir, "tokens.yaml"), "utf8")).value as {
    colors: Record<string, string>;
  },
  css: fs.readFileSync(path.join(dir, "style.css"), "utf8"),
});
const { css } = read(SYSTEM);

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
  ["border-strong", "bg", 3],
  ["border-strong", "surface", 3],
];

describe.each([
  ["the default design system (theme design spec D1)", SYSTEM],
  ["the Material design system (borrowing from Material 3, D7)", MATERIAL],
])("%s", (_name, dir) => {
  const { tokens, css } = read(dir);

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

  it("gives theme_lint nothing to report in a new theme made from it", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bj-lint-"));
    const site = path.join(tmp, "site");
    writeStarter(site, { title: "Aurora", language: "en-US" });
    makeThemeProject(site, { name: "aurora", displayName: "Aurora" }, DEMO);
    const theme = path.join(site, "themes", "aurora");
    fs.copyFileSync(path.join(dir, "tokens.yaml"), path.join(theme, "tokens.yaml"));
    fs.copyFileSync(path.join(dir, "style.css"), path.join(theme, "assets", "style.css"));
    const files = {
      list: async (sub: string) =>
        (fs.readdirSync(path.join(site, sub), { recursive: true, withFileTypes: true }) as fs.Dirent[])
          .filter((d) => d.isFile())
          .map((d) => path.relative(site, path.join(d.parentPath, d.name)).split(path.sep).join("/")),
      read: async (paths: readonly string[]) =>
        new Map(paths.map((p) => [p, fs.readFileSync(path.join(site, p), "utf8")] as const)),
    };
    expect(await lintThemeFiles("themes/aurora", files)).toEqual([]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("making a theme from the default design system (theme design spec D1)", () => {
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

describe("the theme design lint (theme design spec D2)", () => {
  const tokensText = fs.readFileSync(path.join(SYSTEM, "tokens.yaml"), "utf8");
  const clean = () =>
    new Map([
      ["tokens.yaml", tokensText],
      ["assets/style.css", css],
      ["layouts/layouts/base.html", '<link rel="stylesheet" href="{{ asset_base_url }}/assets/style.css" />'],
    ]);
  const rules = (files: Map<string, string>) => lintTheme(files).map((i) => i.rule);

  it("finds nothing in a new theme made from the default design system", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bj-lint-"));
    const site = path.join(dir, "site");
    writeStarter(site, { title: "Aurora", language: "en-US" });
    makeThemeProject(site, { name: "aurora", displayName: "Aurora" }, DEMO);
    const files = {
      list: async (sub: string) =>
        (fs.readdirSync(path.join(site, sub), { recursive: true, withFileTypes: true }) as fs.Dirent[])
          .filter((d) => d.isFile())
          .map((d) => path.relative(site, path.join(d.parentPath, d.name)).split(path.sep).join("/")),
      read: async (paths: readonly string[]) =>
        new Map(paths.map((p) => [p, fs.readFileSync(path.join(site, p), "utf8")] as const)),
    };
    expect(await lintThemeFiles("themes/aurora", files)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports missing tokens and contrast in both schemes", () => {
    const files = clean();
    files.set(
      "tokens.yaml",
      tokensText.replace(/^ {2}muted: .*$/m, '  muted: "#bbbbbb"').replace(/^ {2}wide: .*$/m, ""),
    );
    files.set("assets/style.css", `${css}\n@media (prefers-color-scheme: dark) { :root { --color-link: #333333; } }\n`);
    const issues = lintTheme(files);
    expect(issues.find((i) => i.rule === "tokens_missing")?.detail).toContain("layout.wide");
    const contrast = issues.filter((i) => i.rule === "contrast").map((i) => i.detail);
    expect(contrast.some((d) => d.startsWith("light scheme: muted #bbbbbb on bg"))).toBe(true);
    expect(contrast.some((d) => d.startsWith("dark scheme: link #333333 on bg"))).toBe(true);
    files.set("tokens.yaml", tokensText.replace(/^ {2}border-strong: .*$/m, '  border-strong: "#dcd9d2"'));
    const border = lintTheme(files)
      .filter((i) => i.rule === "contrast")
      .map((i) => i.detail);
    expect(border.some((d) => d.startsWith("light scheme: border-strong #dcd9d2 on surface"))).toBe(true);
    files.delete("tokens.yaml");
    expect(lintTheme(files).find((i) => i.rule === "tokens_missing")?.file).toBeNull();
  });

  it("reports literal colors, outside resources, focus, motion and AI-look patterns with their lines", () => {
    const files = clean();
    files.set(
      "assets/extra.css",
      [
        "/* #ff00ff in a comment is fine */",
        ".card { color: #ff00ff; transition: all 0.2s; }",
        ".hero { background: url(https://cdn.example.com/x.png); }",
        ".title { background-clip: text; -webkit-background-clip: text; }",
        ".nav { backdrop-filter: blur(8px); }",
        ".notion-red { color: #ff0000; }",
        "@media print { a { color: #000; } }",
        "@import url('//fonts.example.com/a.css');",
      ].join("\n"),
    );
    files.set(
      "layouts/partials/header.html",
      '<a href="https://example.com">x</a>\n<h2>🚀 Fast</h2>\n<script src="https://cdn.example.com/a.js"></script>',
    );
    const issues = lintTheme(files);
    const at = (rule: string, file: string) => issues.find((i) => i.rule === rule && i.file === file);
    expect(at("literal_color", "assets/extra.css")).toMatchObject({ line: 2 });
    expect(at("literal_color", "assets/extra.css")?.detail).toContain("line 2.");
    expect(at("transition_all", "assets/extra.css")).toMatchObject({ line: 2 });
    // style.css's reduced-motion block covers the other stylesheets too.
    expect(at("reduced_motion", "assets/extra.css")).toBeUndefined();
    expect(at("external_resource", "assets/extra.css")?.detail).toContain("lines 3, 8");
    expect(at("gradient_text", "assets/extra.css")).toMatchObject({ line: 4 });
    expect(at("frosted_glass", "assets/extra.css")).toMatchObject({ line: 5 });
    expect(at("external_resource", "layouts/partials/header.html")).toMatchObject({ line: 3 });
    expect(at("emoji", "layouts/partials/header.html")).toMatchObject({ line: 2 });
    expect(issues.some((i) => i.rule === "focus_visible")).toBe(false);
    expect(rules(clean())).toEqual([]);
  });

  it("reports a theme with no :focus-visible style, and © or arrows are not emoji", () => {
    const files = new Map([
      ["tokens.yaml", tokensText],
      ["assets/style.css", "a { outline: none; color: var(--color-link); }"],
      ["static/404.html", "<p>© 2026 → home</p>"],
    ]);
    expect(lintTheme(files).filter((i) => i.rule === "focus_visible")).toEqual([
      { rule: "focus_visible", file: "assets/style.css", line: 1, detail: expect.stringContaining(":focus-visible") },
    ]);
    // A :focus-visible in a comment does not count.
    files.set("assets/style.css", "/* a:focus-visible later */\na { color: var(--color-link); }");
    expect(rules(files)).toEqual(["focus_visible"]);
    files.set("assets/style.css", "a:focus-visible { outline: 2px solid; }\na { transition: color 0.2s; }");
    expect(lintTheme(files).filter((i) => i.rule === "reduced_motion")).toMatchObject([
      { file: "assets/style.css", line: 2 },
    ]);
    files.set("assets/motion.css", "@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }");
    expect(rules(files)).toEqual([]);
  });

  it("does not report what is turned off, text symbols or non-palette rules, and finds real emoji", () => {
    const run = (css: string, html = "") =>
      rules(
        new Map([
          ["tokens.yaml", tokensText],
          ["assets/a.css", `a:focus-visible { outline: 2px solid; }\n${css}`],
          ["layouts/x.html", html],
        ]),
      );
    expect(run(".a { backdrop-filter: none; transition: none; animation : none; }")).toEqual([]);
    expect(run(".a { backdrop-filter:blur(2px); }")).toEqual(["frosted_glass"]);
    expect(run("", "<button>☰</button><span>★ © ™ →</span>")).toEqual([]);
    for (const emoji of ["✨", "✅", "⭐", "🚀", "❤️"])
      expect(run("", `<h2>${emoji} New</h2>`), emoji).toEqual(["emoji"]);
    // Only the `.token` class is a code highlighting palette, and `not print` is the screen.
    expect(run(".token-list { color: #f00; }")).toEqual(["literal_color"]);
    expect(run(".token.keyword { color: #f00; }")).toEqual([]);
    expect(run("@media not print { .a { color: #f00; } }")).toEqual(["literal_color"]);
    expect(
      run("@media screen, print { .a { color: #f00; } }\n@media print and (color) { .b { color: #000; } }"),
    ).toEqual([]);
  });

  it("reports violet or lavender theme colors in either scheme, not in content palettes (D6)", () => {
    const files = clean();
    files.set("tokens.yaml", tokensText.replace(/^ {2}accent: .*$/m, '  accent: "#6d28d9"'));
    const light = lintTheme(files).find((i) => i.rule === "violet");
    expect(light).toMatchObject({ file: "tokens.yaml", detail: "light scheme: accent #6d28d9 is violet or lavender." });
    files.set("tokens.yaml", tokensText);
    files.set("assets/style.css", `${css}\n@media (prefers-color-scheme: dark) { :root { --color-link: #c4b5fd; } }\n`);
    expect(lintTheme(files).find((i) => i.rule === "violet")?.detail).toBe(
      "dark scheme: link #c4b5fd is violet or lavender.",
    );
    // Blue, pink and grey are not violet; the default code highlighting (with a lavender) is content.
    files.set("assets/style.css", css);
    for (const color of ["#1d5a8c", "#db2777", "#8b8b9a"]) {
      files.set("tokens.yaml", tokensText.replace(/^ {2}accent: .*$/m, `  accent: "${color}"`));
      expect(rules(files), color).not.toContain("violet");
    }
  });

  it("reports content revealed on scroll, and not an IntersectionObserver that only lazy-loads (D6)", () => {
    const at = (path: string, text: string) => {
      const files = clean();
      files.set(path, text);
      return lintTheme(files).filter((i) => i.rule === "scroll_reveal");
    };
    expect(at("assets/x.css", ".card {\n  animation-timeline: view();\n}")).toEqual([
      expect.objectContaining({ file: "assets/x.css", line: 2 }),
    ]);
    const reveal =
      "const io = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.add('is-visible')));";
    expect(at("assets/reveal.js", `// cards\n${reveal}`)).toEqual([
      expect.objectContaining({ file: "assets/reveal.js", line: 2 }),
    ]);
    expect(at("layouts/pages/index.html", `<main class="fade">\n</main>\n<script>\n${reveal}\n</script>`)).toEqual([
      expect.objectContaining({ line: 4 }),
    ]);
    const lazy = "new IntersectionObserver((es) => es.forEach((e) => { e.target.src = e.target.dataset.src; }));";
    expect(at("assets/lazy.js", lazy)).toEqual([]);
    // The class names outside a script do not make a lazy-loading script a reveal.
    expect(at("layouts/pages/index.html", `<main class="fade"></main><script>${lazy}</script>`)).toEqual([]);
  });

  it("reports tilt, and not a turn by a multiple of 90 degrees or one outside hover and focus (D6)", () => {
    const tilt = (text: string, path = "assets/x.css") => {
      const files = clean();
      files.set(path, text);
      return lintTheme(files)
        .filter((i) => i.rule === "tilt")
        .map((i) => i.line);
    };
    expect(tilt(".card:hover {\n  transform: rotateY(8deg);\n}")).toEqual([2]);
    expect(tilt(".grid {\n  perspective: 800px;\n}")).toEqual([2]);
    expect(tilt(".card:hover {\n  transform: rotate(-2deg) scale(1.02);\n}")).toEqual([2]);
    expect(tilt(".card:focus-visible { rotate: 0.01turn; }")).toEqual([1]);
    expect(tilt(".tag:hover { transform: skewX(4deg); }")).toEqual([1]);
    expect(tilt(".chevron:hover { transform: rotate(180deg); }\n.x:hover { transform: rotate(0.5turn); }")).toEqual([]);
    expect(tilt(".spinner { transform: rotate(12deg); }\n.grid { perspective: none; }")).toEqual([]);
    expect(tilt('<div class="card" data-tilt></div>', "layouts/pages/index.html")).toEqual([1]);
    expect(tilt("import VanillaTilt from './vanilla-tilt.js';", "assets/cards.js")).toEqual([1]);
  });

  it("scans pathological stylesheets and templates in linear time", () => {
    const big = 200 * 1024;
    const cases: [string, string][] = [
      ["assets/a.css", `a { color: var(--color-text); }\n/*${" ".repeat(big)}*/`],
      ["assets/a.css", `@media (prefers-color-scheme: dark) {${" ".repeat(big)}}`],
      ["assets/a.css", "/*".repeat(big / 2)],
      ["assets/a.css", "@media (prefers-color-scheme: dark) {".repeat(big / 40)],
      ["assets/a.css", "@media ".repeat(big / 7)],
      ["assets/a.css", "{".repeat(big)],
      ["layouts/x.html", "<script ".repeat(big / 8)],
      ["layouts/x.html", "<script>".repeat(big / 8)],
      ["assets/a.css", `a:hover { ${"rotate(1".repeat(big / 8)} }`],
      ["assets/a.css", `perspective${" ".repeat(big)}`],
      ["assets/a.js", "IntersectionObserver".repeat(big / 20)],
    ];
    for (const [file, text] of cases) {
      const started = performance.now();
      lintTheme(
        new Map([
          ["tokens.yaml", tokensText],
          [file, text],
        ]),
      );
      expect(performance.now() - started, text.slice(0, 40)).toBeLessThan(1000);
    }
    // Comments still blank to spaces, nested and overlapping skipped blocks still skip.
    const css =
      "a:focus-visible { outline: 2px solid; }\n@media print { @media (prefers-color-scheme: dark) { a { color: #000; } } }\n/* #fff";
    expect(
      rules(
        new Map([
          ["tokens.yaml", tokensText],
          ["assets/a.css", css],
        ]),
      ),
    ).toEqual([]);
  });

  it("removing the outline is only `none` or `0`, and line numbers hold in long files", () => {
    const files = (css: string) =>
      new Map([
        ["tokens.yaml", tokensText],
        ["assets/a.css", css],
      ]);
    const focus = (css: string) => lintTheme(files(css)).filter((i) => i.rule === "focus_visible");
    expect(focus("a { outline: 0.5px solid; }")).toEqual([expect.objectContaining({ file: null })]);
    expect(focus("a { outline: 0; }")).toEqual([expect.objectContaining({ file: "assets/a.css", line: 1 })]);
    const long = `${"a { color: var(--color-text); }\n".repeat(20_000)}b { color: #f00; }\n`;
    expect(lintTheme(files(`a:focus-visible { outline: 2px solid; }\n${long}`))).toEqual([
      expect.objectContaining({ rule: "literal_color", line: 20_002 }),
    ]);
  });
});
