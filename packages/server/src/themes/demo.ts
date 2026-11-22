import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

/** The theme `bukit new` writes. */
const STARTER_THEME = "starter";

/**
 * Turn the site `bukit new` wrote at `target` into a theme project (theme development design 3.1, 3.4, 4):
 * the starter theme becomes `themes/<themeName>/` (directory, theme.yaml `name` and site.yaml `theme.name`)
 * shown as `displayName`, and `content/` is replaced with the bundled sample content from `demoDir`, which
 * covers every page type.
 */
export function makeThemeProject(target: string, theme: { name: string; displayName: string }, demoDir: string): void {
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
  applyDesignSystem(path.join(themes, theme.name), demoDir);
  replaceSampleContent(target, demoDir);
}

/** The starter's stylesheet link in its base layout; the token stylesheet goes right before it. */
const STARTER_STYLESHEET = /^([ \t]*)<link rel="stylesheet" href="\{\{ asset_base_url \}\}\/assets\/style\.css" \/>$/m;

/**
 * Put BukitJalil's default design system (plan 14, theme design spec D1) into a starter theme: its
 * tokens.yaml, its style.css in place of the starter's, and a link to the generated token stylesheet in
 * the base layout. The CSS is written for the starter's markup, so the templates stay as Bukit wrote them.
 * Throws when the base layout no longer has the starter's stylesheet link, so a changed starter fails the
 * creation instead of making an unstyled theme.
 */
export function applyDesignSystem(themeRoot: string, demoDir: string): void {
  const source = path.join(demoDir, "design-system");
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
