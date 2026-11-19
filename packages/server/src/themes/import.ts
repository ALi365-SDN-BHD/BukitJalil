import fs from "node:fs";
import path from "node:path";
import { type ThemeCandidate, type ThemeImportInspection, ThemeName } from "@bukitjalil/shared";
import { isRecord, pathProblem } from "../bukit/guard.ts";
import { readZipTree } from "../bukit/install.ts";
import { parseYaml } from "../panels/yaml.ts";
import { findConfigCandidates } from "../sites/config-candidates.ts";
import { SiteError } from "../sites/location.ts";

/** Limits shared with the media upload (design 5): a theme is small. */
const MAX_TOTAL = 50 * 1024 * 1024;
const MAX_FILE = 14 * 1024 * 1024;
const MAX_FILES = 5000;
/** A theme manifest is small; a bigger one is not read at all (it cannot be a theme Bukit accepts). */
const MAX_MANIFEST_FILE = 1024 * 1024;
/** Archive metadata written by macOS and Windows; never part of a theme. */
const METADATA = new Set(["__MACOSX", ".DS_Store", "Thumbs.db"]);
/** A compressed theme archive is read into memory before it is checked; bigger is refused outright. */
const MAX_ZIP = 100 * 1024 * 1024;
const MANIFEST = "theme.yaml";

/** The files of one theme, and the directory it is written to. */
export interface ImportedTheme {
  name: string;
  dirs: { dir: string; files: Map<string, Buffer> }[];
}

/** A folder or a zip, seen as a tree of regular files with no symlinks (design 5). */
interface Tree {
  read(rel: string, maxBytes?: number): Buffer | null;
  list(dir: string): string[];
  scan(dir: string, budget: { total: number; files: number }): Map<string, Buffer>;
}

/** One source: where its themes are, and how to read them. */
interface Source {
  tree: Tree;
  /** A single theme folder (the user pointed at it) rather than a site or a collection of themes. */
  single: string | null;
  /** A zip whose root is the theme itself. */
  rootTheme: boolean;
  site: { configFile: string } | null;
}

/**
 * Inspect a folder or zip for importable themes without writing anything (design 5). A folder can also
 * be a Bukit site, which the site importer can take; a theme may extend a parent found in the same source.
 */
export async function inspectThemeSource(sourcePath: string): Promise<ThemeImportInspection> {
  const source = openSource(sourcePath);
  return { path: fs.realpathSync.native(sourcePath), site: source.site, themes: candidates(source) };
}

/**
 * Load the selected theme and its parents for import (design 5), re-reading the source so a failed inspect
 * cannot be replayed with different files. Refuses unsafe content, missing parents and oversized themes.
 */
export async function loadTheme(sourcePath: string, id: string): Promise<ImportedTheme> {
  const source = openSource(sourcePath);
  const candidate = candidates(source).find((c) => c.id === id);
  if (!candidate) throw invalid("the theme is not in this folder");
  if (candidate.missingParent !== null)
    throw new SiteError("theme.parent_missing", 409, { theme: candidate.dir, parent: candidate.missingParent });
  const budget = { total: 0, files: 0 };
  const dirs: { dir: string; files: Map<string, Buffer> }[] = [];
  for (const dir of parentChain(source.tree, candidate.id).reverse()) {
    const files = source.tree.scan(dir, budget);
    if (files.size === 0) throw invalid(`the theme ${dir} has no files`);
    dirs.push({ dir: dir === "." ? candidate.dir : themeDirName(dir), files });
  }
  return { name: candidate.dir, dirs };
}

/** The candidates in a source, parents resolved within it; refused entries are left out. */
function candidates(source: Source): ThemeCandidate[] {
  const dirs = source.single !== null ? [source.single] : source.rootTheme ? ["."] : themeDirs(source.tree);
  const out: ThemeCandidate[] = [];
  for (const dir of dirs) {
    const manifest = manifestOf(source.tree, dir);
    if (!manifest) continue;
    const chain = parentChain(source.tree, dir);
    const target = (d: string) => (d === "." ? manifest.name : themeDirName(d));
    out.push({
      id: dir,
      dir: target(dir),
      displayName: manifest.displayName,
      includes: chain.map(target).reverse(),
      missingParent: missingParent(source.tree, dir),
    });
  }
  return out;
}

/** The theme's manifest, or null when it is missing, unreadable, or uses an invalid name. */
function manifestOf(tree: Tree, dir: string) {
  const raw = tree.read(join(dir, MANIFEST), MAX_MANIFEST_FILE);
  if (raw === null) return null;
  const parsed = parseYaml(raw.toString("utf8"));
  if (parsed.error !== null || !isRecord(parsed.value)) return null;
  const name = parsed.value.name;
  if (typeof name !== "string" || !ThemeName.safeParse(name).success) return null;
  // The directory is what `extends` names; a mismatch would import a theme Bukit cannot find.
  if (dir !== "." && themeDirName(dir) !== name) return null;
  const extendsName = parsed.value.extends;
  const parent = typeof extendsName === "string" ? extendsName.trim() : null;
  if (parent !== null && !ThemeName.safeParse(parent).success) return null;
  const displayName = typeof parsed.value.display_name === "string" ? parsed.value.display_name.trim() : null;
  return { name, displayName: displayName || null, parent };
}

/** The theme directories of a collection (a site's themes/ or a zip's themes/), sorted. */
function themeDirs(tree: Tree): string[] {
  const root = tree.list("themes");
  return root
    .filter((name) => tree.read(join("themes", name, MANIFEST)) !== null)
    .map((name) => join("themes", name))
    .sort();
}

/** The theme directory itself, then its parent, grandparent, … (design 5); cycles stop the chain. */
function parentChain(tree: Tree, dir: string): string[] {
  const chain: string[] = [dir];
  const seen = new Set([dir]);
  let current = dir;
  for (;;) {
    const manifest = manifestOf(tree, current);
    if (!manifest?.parent) return chain;
    const next = parentDir(current, manifest.parent);
    if (seen.has(next)) return chain;
    const parent = manifestOf(tree, next);
    if (!parent) return chain;
    seen.add(next);
    chain.push(next);
    current = next;
  }
}

/** The first parent named by the theme that the source does not have, or null. */
function missingParent(tree: Tree, dir: string): string | null {
  const seen = new Set<string>([dir]);
  let current = dir;
  for (;;) {
    const manifest = manifestOf(tree, current);
    if (!manifest?.parent) return null;
    const next = parentDir(current, manifest.parent);
    if (seen.has(next)) return null;
    seen.add(next);
    if (!manifestOf(tree, next)) return manifest.parent;
    current = next;
  }
}

/** Where a named parent theme is relative to this theme. */
function parentDir(dir: string, parent: string): string {
  const slash = dir.lastIndexOf("/");
  return slash < 0 ? parent : `${dir.slice(0, slash)}/${parent}`;
}

/** The directory name a theme is written to (`themes/foo` → foo; a root zip theme → its name). */
function themeDirName(dir: string): string {
  return dir === "." ? "" : (dir.split("/").pop() ?? dir);
}

function join(...parts: string[]): string {
  return parts.filter((p) => p !== "." && p !== "").join("/");
}

function invalid(detail: string): SiteError {
  return new SiteError("theme.import_invalid", 400, { detail });
}

/** Open a folder or zip as a source; a zip's single wrapper directory is removed (a zipped folder). */
function openSource(sourcePath: string): Source {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(sourcePath);
  } catch {
    throw invalid("the folder or file does not exist");
  }
  if (stat.isDirectory()) {
    const real = fs.realpathSync.native(sourcePath);
    if (fs.existsSync(path.join(real, MANIFEST))) {
      return {
        tree: folderTree(path.dirname(real)),
        single: path.basename(real),
        rootTheme: false,
        site: null,
      };
    }
    return {
      tree: folderTree(real),
      single: null,
      rootTheme: false,
      site: siteConfig(real),
    };
  }
  if (!stat.isFile()) throw invalid("the source is not a folder or a file");
  if (stat.size > MAX_ZIP) throw new SiteError("theme.too_large", 409, { max: String(MAX_ZIP) });
  let entries: Map<string, { mode: number; data: Buffer }>;
  try {
    // shortcut: the shared zip reader unpacks up to 200 MiB before the theme's 50 MiB limit applies;
    // the source is a local file the user picked, so the extra memory is acceptable. Upgrade if a zip
    // ever arrives over the network or from another app.
    entries = readZipTree(fs.readFileSync(sourcePath));
  } catch {
    throw invalid("the zip cannot be read safely");
  }
  const files = new Map(
    [...entries]
      .filter(([name]) => !name.split("/").some((part) => metadata(part)))
      .map(([name, file]) => [name, file.data]),
  );
  const stripped = stripWrapper(files);
  return { tree: zipTree(stripped), single: null, rootTheme: stripped.has(MANIFEST), site: null };
}

/** A site config at the folder's root, if any: the site importer can take this folder (design 5). */
function siteConfig(dir: string): { configFile: string } | null {
  try {
    const files = findConfigCandidates(dir);
    return files[0] ? { configFile: files[0] } : null;
  } catch {
    return null;
  }
}

/** A zip of `mytheme/` written by zipping the folder: drop the wrapper when it is the only top folder. */
function stripWrapper(files: Map<string, Buffer>): Map<string, Buffer> {
  const names = [...files.keys()];
  if (names.some((n) => n === MANIFEST || n.startsWith("themes/"))) return files;
  const first = names.map((n) => n.split("/")[0] ?? "").filter(Boolean);
  const wrapper = first[0];
  if (!wrapper || first.some((n) => n !== wrapper)) return files;
  const inner = names.map((n) => n.slice(wrapper.length + 1));
  if (!inner.some((n) => n === MANIFEST || n.startsWith("themes/"))) return files;
  return new Map([...files].map(([n, data]) => [n.slice(wrapper.length + 1), data]));
}

/** A folder tree: only regular files, no symlinks, with the unsafe names the import refuses (design 5). */
function folderTree(root: string): Tree {
  const scanDir = (dir: string, rel: string, budget: { total: number; files: number }, out: Map<string, Buffer>) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (name === ".git" || name === "node_modules" || name.startsWith(".env") || metadata(name)) continue;
      const abs = path.join(dir, name);
      const child = join(rel, name);
      unsafeName(child);
      const stat = fs.lstatSync(abs);
      if (stat.isSymbolicLink()) throw unsafe(`symbolic link: ${child}`);
      if (stat.isDirectory()) {
        scanDir(abs, child, budget, out);
        continue;
      }
      if (!stat.isFile()) throw unsafe(`not a regular file: ${child}`);
      if (stat.size > MAX_FILE) throw new SiteError("theme.too_large", 409, { max: String(MAX_FILE) });
      addFile(child, fs.readFileSync(abs), budget, out);
    }
  };
  return {
    read(rel, maxBytes = MAX_FILE) {
      if (pathProblem(rel) !== null) return null;
      const abs = path.join(root, ...rel.split("/"));
      const stat = fs.lstatSync(abs, { throwIfNoEntry: false });
      if (!stat?.isFile()) return null;
      if (stat.size > maxBytes) throw new SiteError("theme.too_large", 409, { max: String(maxBytes) });
      return fs.readFileSync(abs);
    },
    list(dir) {
      if (pathProblem(dir) !== null) return [];
      try {
        return fs
          .readdirSync(path.join(root, ...dir.split("/")), { withFileTypes: true })
          .filter((e) => e.isDirectory() && !metadata(e.name))
          .map((e) => e.name);
      } catch {
        return [];
      }
    },
    scan(dir, budget) {
      const out = new Map<string, Buffer>();
      if (pathProblem(dir) !== null) throw unsafe(`bad path: ${dir}`);
      const rel = dir === "." ? "" : dir;
      const abs = path.join(root, ...(rel === "" ? [] : rel.split("/")));
      const stat = fs.lstatSync(abs, { throwIfNoEntry: false });
      if (!stat?.isDirectory()) return out;
      // Paths in the result are relative to the theme, which is what gets written under themes/<name>/.
      scanDir(abs, "", budget, out);
      return out;
    },
  };
}

/** A zip tree: names and sizes are checked by readZipTree; the import's own limits apply here. */
function zipTree(files: Map<string, Buffer>): Tree {
  return {
    read(rel, maxBytes = MAX_FILE) {
      const data = files.get(rel);
      if (data === undefined) return null;
      if (data.length > maxBytes) throw new SiteError("theme.too_large", 409, { max: String(maxBytes) });
      return data;
    },
    list(dir) {
      const prefix = dir === "." ? "" : `${dir}/`;
      const names = new Set<string>();
      for (const name of files.keys()) {
        if (!name.startsWith(prefix)) continue;
        const rest = name.slice(prefix.length);
        if (!rest.includes("/")) names.add(rest);
        else names.add(rest.split("/")[0] ?? "");
      }
      return [...names].filter((n) => !metadata(n) && files.has(join(dir, n, MANIFEST)));
    },
    scan(dir, budget) {
      const prefix = dir === "." ? "" : `${dir}/`;
      const out = new Map<string, Buffer>();
      for (const [name, data] of files) {
        if (!name.startsWith(prefix)) continue;
        const rel = name.slice(prefix.length);
        if (rel === "" || rel.split("/").some((part) => part === ".git" || part === "node_modules")) continue;
        if (rel.split("/").some((part) => part.startsWith(".env") || metadata(part))) continue;
        unsafeName(rel);
        addFile(rel, data, budget, out);
      }
      return out;
    },
  };
}

/** Refuse plugin files a site may not carry (design 5, plan 8.5). */
function unsafeName(rel: string): void {
  const parts = rel.split("/");
  const lower = parts.map((p) => p.toLowerCase());
  if (lower.includes("plugins") || lower.includes("plugin.yaml") || rel.toLowerCase() === ".bukit/plugins.yaml")
    throw unsafe(`plugin file: ${rel}`);
}

function unsafe(detail: string): SiteError {
  return new SiteError("theme.import_unsafe", 409, { detail });
}

function addFile(rel: string, data: Buffer, budget: { total: number; files: number }, out: Map<string, Buffer>): void {
  if (data.length > MAX_FILE) throw new SiteError("theme.too_large", 409, { max: String(MAX_FILE) });
  budget.files += 1;
  budget.total += data.length;
  if (budget.files > MAX_FILES) throw new SiteError("theme.too_many_files", 409, { max: String(MAX_FILES) });
  if (budget.total > MAX_TOTAL) throw new SiteError("theme.too_large", 409, { max: String(MAX_TOTAL) });
  out.set(rel, data);
}

/** macOS/Windows archive metadata that is never copied into a theme. */
function metadata(name: string): boolean {
  return METADATA.has(name) || name.startsWith("._");
}
