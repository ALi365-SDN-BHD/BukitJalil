import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

/**
 * Copy the starter template into a new site directory (plan 5.2 steps 2–3). The template lives in
 * templates/starter/ and is regenerated from Bukit's StarterTheme by scripts/make-starter.sh.
 * Checking where the site may be created belongs to the caller; this only needs an empty or missing target.
 */

export interface StarterValues {
  /** Display name, used as site.title and the theme's brand text. */
  title: string;
  /** BCP 47 tag, e.g. "zh-CN" or "en-US". */
  language: string;
}

const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function validateStarterValues(values: StarterValues): string | null {
  const title = values.title.trim();
  if (title.length === 0 || title.length > 200) return "title must be 1-200 characters";
  // Control, format (bidi overrides, zero-width) and line/paragraph separator characters.
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(title)) return "title must not contain control characters";
  if (!LANGUAGE.test(values.language)) return "language must be a BCP 47 tag like zh-CN";
  return null;
}

/** site.name: a lower-case ASCII slug of the title, or "site" when the title has no ASCII letters or digits. */
export function siteSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return slug || "site";
}

/**
 * Copy `templateDir` into `target` (created if missing; must be empty) and fill in site.yaml.
 * On failure everything written is removed again, so the same location can be retried.
 */
export function copyStarter(templateDir: string, target: string, values: StarterValues): void {
  const problem = validateStarterValues(values);
  if (problem) throw new Error(problem);
  const existed = fs.existsSync(target);
  if (existed && (!fs.lstatSync(target).isDirectory() || fs.readdirSync(target).length > 0)) {
    throw new Error(`${target} must be an empty directory`);
  }
  const siteYaml = fillSiteYaml(fs.readFileSync(path.join(templateDir, "site.yaml"), "utf8"), values);
  // Only the deepest new directory is ours to remove; parents created on the way stay (empty).
  if (!existed) fs.mkdirSync(target, { recursive: true });
  try {
    copyTree(templateDir, target);
    fs.writeFileSync(path.join(target, "site.yaml"), siteYaml);
  } catch (err) {
    if (existed) {
      for (const name of fs.readdirSync(target)) fs.rmSync(path.join(target, name), { recursive: true, force: true });
    } else {
      fs.rmSync(target, { recursive: true, force: true });
    }
    throw err;
  }
}

/** Set the form values in the template's site.yaml, keeping its layout and comments. */
export function fillSiteYaml(text: string, values: StarterValues): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new Error(`template site.yaml is invalid: ${doc.errors[0]?.message}`);
  const title = values.title.trim();
  doc.setIn(["site", "name"], siteSlug(title));
  doc.setIn(["site", "title"], title);
  doc.setIn(["site", "language"], values.language);
  doc.setIn(["theme", "params", "brand"], title);
  doc.setIn(["theme", "params", "footer_text"], title);
  return doc.toString();
}

/** Plain recursive copy of directories and regular files; anything else in the template is an error. */
function copyTree(from: string, to: string): void {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dst, { mode: 0o755 });
      copyTree(src, dst);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(dst, 0o644);
    } else {
      throw new Error(`unexpected entry in the template: ${src}`);
    }
  }
}
