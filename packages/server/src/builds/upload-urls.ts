import fs from "node:fs";
import path from "node:path";
import { foldName } from "../names.ts";

/** A root-path upload reference that does not resolve under the site's current baseUrl (design 4.9). */
export interface UploadUrlProblem {
  /** Output-relative HTML page, with "/" separators. */
  page: string;
  /** The URL as written in the page. */
  url: string;
}

const ATTR = /\b(src|href|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Every root-path `src`, `href` and `srcset` candidate whose last two path segments are `uploads/<name>`,
 * when `<name>` exists in the output's uploads. Such a URL passes only if it starts with `basePath` and the
 * remaining path is an exact-case regular file in the output. Absolute, protocol-relative, relative and data
 * URLs are ignored, as are pages whose referenced file is not in an uploads folder at all.
 */
export function findUploadUrlProblems(outputDir: string, basePath: string): UploadUrlProblem[] {
  const names = uploadNames(outputDir);
  if (names.size === 0) return [];
  const folded = new Set([...names].map(foldName));
  const base = basePath.split("/").filter(Boolean);
  const problems: UploadUrlProblem[] = [];
  const seen = new Set<string>();
  for (const file of htmlFiles(outputDir)) {
    const page = path.relative(outputDir, file).split(path.sep).join("/");
    for (const url of candidates(readHtml(file))) {
      if (!isProblem(url, names, folded, base, outputDir)) continue;
      const key = `${page}\0${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push({ page, url });
    }
  }
  return problems;
}

function isProblem(url: string, names: Set<string>, folded: Set<string>, base: string[], outputDir: string): boolean {
  if (!url.startsWith("/") || url.startsWith("//")) return false;
  const pathOnly = url.split(/[?#]/, 1)[0] ?? "";
  const segments = pathOnly.split("/").filter(Boolean);
  if (segments.length < 2 || segments.at(-2) !== "uploads") return false;
  const name = segments.at(-1) ?? "";
  // A case-only mismatch still 404s on Pages; report it rather than treating the file as absent.
  if (!names.has(name)) return folded.has(foldName(name));
  // A root path that does not carry the site's prefix 404s after publishing, even when the same file exists
  // at the output root: GitHub Pages serves a project site under /<repo>/.
  if (!startsWith(segments, base)) return true;
  if (segments.includes("..")) return true;
  return !hasExactFile(outputDir, segments.slice(base.length));
}

/** Exact-case file lookup, so a wrong-case link is reported on macOS too (Pages is case-sensitive). */
function hasExactFile(root: string, segments: string[]): boolean {
  let current = root;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as string;
    const entry = readdir(current).find((x) => x.name === segment);
    if (!entry) return false;
    if (i === segments.length - 1) return entry.isFile();
    if (!entry.isDirectory()) return false;
    current = path.join(current, segment);
  }
  return false;
}

/** File names under the output root's uploads and under every language directory's uploads. */
function uploadNames(outputDir: string): Set<string> {
  const names = new Set<string>();
  const add = (dir: string) => {
    if (!fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) return;
    for (const entry of readdir(dir)) if (entry.isFile()) names.add(entry.name);
  };
  add(path.join(outputDir, "uploads"));
  for (const entry of readdir(outputDir)) if (entry.isDirectory()) add(path.join(outputDir, entry.name, "uploads"));
  return names;
}

function readHtml(file: string): string {
  try {
    // Scripts and comments are not links; a string in them must not block a publish.
    return fs
      .readFileSync(file, "utf8")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "");
  } catch {
    return "";
  }
}

function* candidates(html: string): Generator<string> {
  for (const match of html.matchAll(ATTR)) {
    const value = match[2] ?? match[3] ?? "";
    if (match[1]?.toLowerCase() !== "srcset") {
      yield value.trim();
      continue;
    }
    for (const part of value.split(",")) {
      const url = part.trim().split(/\s+/, 1)[0];
      if (url) yield url;
    }
  }
}

function htmlFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdir(dir)) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) files.push(abs);
    }
  };
  walk(root);
  return files;
}

/** Sorted so a report is stable; symlinks and unreadable directories are skipped. */
function readdir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function startsWith(segments: string[], prefix: string[]): boolean {
  return prefix.every((segment, i) => segments[i] === segment);
}
