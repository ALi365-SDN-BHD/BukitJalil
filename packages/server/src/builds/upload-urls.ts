import fs from "node:fs";
import path from "node:path";
import { SAXParser } from "parse5-sax-parser";
import { foldName } from "../names.ts";

/** A root-path upload reference that does not resolve under the site's current baseUrl (design 4.9). */
export interface UploadUrlProblem {
  /** Output-relative HTML page, with "/" separators. */
  page: string;
  /** The URL from the HTML attribute, after character references are decoded. */
  url: string;
}

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
  const { pages, paths } = indexOutput(outputDir, names);
  for (const page of pages) {
    for (const url of candidates(readHtml(path.join(outputDir, page)))) {
      if (!isProblem(url, names, folded, base, paths)) continue;
      const key = `${page}\0${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push({ page, url });
    }
  }
  return problems;
}

function isProblem(url: string, names: Set<string>, folded: Set<string>, base: string[], paths: Set<string>): boolean {
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
  return !paths.has(segments.slice(base.length).join("/"));
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
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function candidates(html: string): string[] {
  const urls: string[] = [];
  const parser = new SAXParser();
  parser.on("startTag", ({ attrs }) => {
    for (const { name, value, prefix } of attrs) {
      if (prefix) continue;
      if (name === "src" || name === "href") urls.push(value.trim());
      else if (name === "srcset") {
        // A URL token runs to ASCII whitespace: commas inside it (e.g. data: URLs) are not separators.
        const token = /[^\t\n\f\r ,][^\t\n\f\r ]*/g;
        for (let match = token.exec(value); match; match = token.exec(value)) {
          const url = match[0];
          let end = url.length;
          while (url[end - 1] === ",") end--;
          urls.push(url.slice(0, end));
          if (end !== url.length) continue;
          const comma = value.indexOf(",", token.lastIndex);
          if (comma < 0) break;
          token.lastIndex = comma + 1;
        }
      }
    }
  });
  parser.end(html);
  return urls;
}

/** Index the exact spelling of regular files once, not once per link on every page. */
function indexOutput(root: string, names: Set<string>) {
  const pages: string[] = [];
  const paths = new Set<string>();
  const walk = (prefix: string) => {
    for (const entry of readdir(path.join(root, prefix))) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) walk(`${rel}/`);
      else if (entry.isFile()) {
        if (entry.name.toLowerCase().endsWith(".html")) pages.push(rel);
        if (names.has(entry.name)) paths.add(rel);
      }
    }
  };
  walk("");
  return { pages, paths };
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
