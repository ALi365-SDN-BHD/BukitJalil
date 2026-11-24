import fs from "node:fs";
import path from "node:path";
import { DesignSystem } from "@bukitjalil/shared";
import { parseDocument } from "yaml";

/** The theme `bukit new` writes. */
const STARTER_THEME = "starter";

/** Each design system's folder in the sample content directory (plan 14 D1, D7). */
const DESIGN_SYSTEM_DIRS: Record<DesignSystem, string> = {
  default: "design-system",
  material: "design-system-material",
};

/**
 * Turn the site `bukit new` wrote at `target` into a theme project (theme development design 3.1, 3.4, 4):
 * the starter theme becomes `themes/<themeName>/` (directory, theme.yaml `name` and site.yaml `theme.name`)
 * shown as `displayName`, and `content/` is replaced with the bundled sample content from `demoDir`, which
 * covers every page type. The theme's look starts from `designSystem`.
 */
export function makeThemeProject(
  target: string,
  theme: { name: string; displayName: string },
  demoDir: string,
  designSystem: DesignSystem = "default",
): void {
  const themes = path.join(target, "themes");
  if (theme.name !== STARTER_THEME) {
    fs.renameSync(path.join(themes, STARTER_THEME), path.join(themes, theme.name));
  }
  setYaml(path.join(themes, theme.name, "theme.yaml"), {
    name: theme.name,
    display_name: theme.displayName,
    description: `${theme.displayName}, a Bukit theme`,
  });
  setYaml(path.join(target, "site.yaml"), { "theme.name": theme.name });
  applyDesignSystem(path.join(themes, theme.name), demoDir, designSystem);
  replaceSampleContent(target, demoDir);
}

/** The starter's stylesheet link in its base layout; the token stylesheet goes right before it. */
const STARTER_STYLESHEET = /^([ \t]*)<link rel="stylesheet" href="\{\{ asset_base_url \}\}\/assets\/style\.css" \/>$/m;

/**
 * Put one of BukitJalil's design systems (plan 14, theme design spec D1, D7) into a starter theme: its
 * tokens.yaml, its style.css in place of the starter's, and a link to the generated token stylesheet in
 * the base layout. The CSS is written for the starter's markup, so the templates stay as Bukit wrote them.
 * Throws when the base layout no longer has the starter's stylesheet link, so a changed starter fails the
 * creation instead of making an unstyled theme.
 */
export function applyDesignSystem(themeRoot: string, demoDir: string, designSystem: DesignSystem = "default"): void {
  const source = path.join(demoDir, DESIGN_SYSTEM_DIRS[designSystem]);
  const base = path.join(themeRoot, "layouts", "layouts", "base.html");
  const layout = fs.readFileSync(base, "utf8");
  if (!STARTER_STYLESHEET.test(layout)) {
    throw new Error("The starter theme's base layout has no stylesheet link to put the design tokens before");
  }
  fs.writeFileSync(
    base,
    layout.replace(
      STARTER_STYLESHEET,
      '$1<link rel="stylesheet" href="{{ asset_base_url }}/assets/css/theme-tokens.css" />\n$&',
    ),
  );
  fs.copyFileSync(path.join(source, "tokens.yaml"), path.join(themeRoot, "tokens.yaml"));
  fs.copyFileSync(path.join(source, "style.css"), path.join(themeRoot, "assets", "style.css"));
}

/** A design system's two files as they are bundled: tokens.yaml and the theme's assets/style.css. */
export interface DesignSystemFiles {
  tokens: string;
  style: string;
}

/** The bundled files of a design system in `demoDir`. */
export function designSystemFiles(demoDir: string, designSystem: DesignSystem): DesignSystemFiles {
  const source = path.join(demoDir, DESIGN_SYSTEM_DIRS[designSystem]);
  return {
    tokens: fs.readFileSync(path.join(source, "tokens.yaml"), "utf8"),
    style: fs.readFileSync(path.join(source, "style.css"), "utf8"),
  };
}

/**
 * The design system a theme's tokens.yaml and style.css are still the bundled originals of (plan 14 D9,
 * Q31), or null when either file is missing, changed or from the other system.
 */
export function unchangedDesignSystem(
  demoDir: string,
  files: { tokens: string | undefined; style: string | undefined },
): DesignSystem | null {
  for (const system of DesignSystem.options) {
    const original = designSystemFiles(demoDir, system);
    if (files.tokens === original.tokens && files.style === original.style) return system;
  }
  return null;
}

/** Remove Bukit's starter theme before an imported theme (and its parents) is written in its place. */
export function removeStarterTheme(target: string): void {
  fs.rmSync(path.join(target, "themes", STARTER_THEME), { recursive: true, force: true });
}

/** Put the sample content in `content/` (design 3.4): every page type must have an example. */
export function replaceSampleContent(target: string, demoDir: string): void {
  const content = path.join(target, "content");
  fs.rmSync(content, { recursive: true, force: true });
  fs.cpSync(path.join(demoDir, "content"), content, { recursive: true });
}

/** Point the sample site at a theme (an imported one keeps its own theme.yaml). */
export function setSiteThemeName(target: string, name: string): void {
  setYaml(path.join(target, "site.yaml"), { "theme.name": name });
}

/** Set dotted keys in a YAML file, keeping the rest of it. */
function setYaml(file: string, values: Record<string, string>): void {
  const doc = parseDocument(fs.readFileSync(file, "utf8"));
  if (doc.errors.length > 0) throw new Error(`${path.basename(file)} is invalid: ${doc.errors[0]?.message}`);
  for (const [key, value] of Object.entries(values)) doc.setIn(key.split("."), value);
  fs.writeFileSync(file, doc.toString());
}
