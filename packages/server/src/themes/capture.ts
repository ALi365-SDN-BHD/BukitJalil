import { isUtf8 } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { pathProblem } from "../bukit/guard.ts";
import { SiteError } from "../sites/location.ts";

/** A capture is small (design 6.2): the desktop already stopped at 30 MiB. */
const MAX_TOTAL = 30 * 1024 * 1024;
const MAX_FILE = 14 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_MANIFEST = 1024 * 1024;

const Manifest = z
  .object({
    format: z.literal(1),
    id: z.string().min(1).max(64),
    origin: z.string().min(1),
    title: z.string().max(1000),
    pages: z
      .array(
        z.object({
          url: z.string().min(1),
          title: z.string().max(1000),
          html: z.string().min(1),
          css: z.string().min(1),
          meta: z.string().min(1),
          screenshots: z.array(z.string().min(1)),
        }),
      )
      .min(1)
      .max(5),
    reference: z.array(z.string().min(1)),
    assets: z.array(z.object({ path: z.string().min(1), source: z.string() })),
  })
  .strict();

/** What the server takes from a capture: pages to read, screenshots to look at. */
export interface LoadedCapture {
  title: string;
  /** Files under `_capture/`, by relative path. */
  files: Map<string, Buffer>;
  /** Screenshots under `_reference/`, by name. */
  references: Map<string, Buffer>;
}

/**
 * Re-validate a desktop capture before it becomes a theme project (design 6.2): only the manifest's files,
 * regular files with no symlinks, real types by content, SVG cleaned of scripts and external references,
 * the size limits applied again. The directory is never trusted because the desktop wrote it.
 */
export function loadCapture(capturesDir: string, id: string): LoadedCapture {
  const dir = path.join(capturesDir, id);
  if (!/^[0-9a-f]{16,64}$/.test(id)) throw invalid("the capture id is not valid");
  const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw missing();
  let manifest: z.infer<typeof Manifest>;
  try {
    const manifestFile = path.join(dir, "manifest.json");
    const manifestStat = fs.lstatSync(manifestFile, { throwIfNoEntry: false });
    if (!manifestStat?.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > MAX_MANIFEST)
      throw invalid("the manifest is missing or too large");
    const raw = fs.readFileSync(manifestFile);
    manifest = Manifest.parse(JSON.parse(raw.toString("utf8")));
  } catch (err) {
    if (err instanceof SiteError) throw err;
    throw invalid("the manifest is missing or not valid");
  }
  if (manifest.id !== id) throw invalid("the manifest names another capture");
  try {
    const origin = new URL(manifest.origin);
    if (origin.protocol !== "http:" && origin.protocol !== "https:") throw invalid("the origin is not http(s)");
    for (const page of manifest.pages) {
      const url = new URL(page.url);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin.origin)
        throw invalid("a page is elsewhere");
    }
  } catch (err) {
    if (err instanceof SiteError) throw err;
    throw invalid("the pages are not one http(s) origin");
  }

  const files = new Map<string, Buffer>();
  const references = new Map<string, Buffer>();
  let total = 0;
  const read = (rel: string, kind: "page" | "asset" | "reference"): Buffer => {
    if (pathProblem(rel) !== null) throw invalid(`bad path: ${rel}`);
    // No symlink anywhere in the path: a link in a parent folder would otherwise reach outside the capture.
    let current = dir;
    for (const part of rel.split("/")) {
      current = path.join(current, part);
      const partStat = fs.lstatSync(current, { throwIfNoEntry: false });
      if (!partStat) break;
      if (partStat.isSymbolicLink()) throw invalid(`symbolic link: ${rel}`);
    }
    const abs = path.join(dir, ...rel.split("/"));
    const stat = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink()) throw invalid(`not a regular file: ${rel}`);
    if (stat.size > MAX_FILE) throw new SiteError("theme.too_large", 409, { max: String(MAX_FILE) });
    total += stat.size;
    if (total > MAX_TOTAL) throw new SiteError("theme.too_large", 409, { max: String(MAX_TOTAL) });
    if (files.size + references.size >= MAX_FILES)
      throw new SiteError("theme.too_many_files", 409, { max: String(MAX_FILES) });
    const data = fs.readFileSync(abs);
    checkType(rel, data, kind);
    const ext = path.extname(rel).toLowerCase();
    return kind === "asset" && (ext === ".svg" || looksSvg(data)) ? Buffer.from(cleanSvg(data.toString("utf8"))) : data;
  };

  for (const page of manifest.pages) {
    // The page's own files keep the structure the conversion skill expects.
    const n = manifest.pages.indexOf(page) + 1;
    files.set(`pages/${n}/index.html`, read(page.html, "page"));
    files.set(`pages/${n}/styles.css`, read(page.css, "page"));
    files.set(`pages/${n}/meta.json`, read(page.meta, "page"));
    for (const shot of page.screenshots) {
      const data = read(shot, "reference");
      // The desktop names them <page>-<width>.png; a capture with two of the same name is not trusted.
      const name = `capture-${path.basename(shot)}`;
      if (references.has(name)) throw invalid(`two screenshots are called ${path.basename(shot)}`);
      references.set(name, data);
    }
  }
  for (const asset of manifest.assets) {
    if (files.has(asset.path)) continue;
    files.set(asset.path, read(asset.path, "asset"));
  }
  // Reference paths outside pages are accepted too (a future capture may list them once).
  for (const ref of manifest.reference) {
    if (manifest.pages.some((p) => p.screenshots.includes(ref))) continue;
    const data = read(ref, "reference");
    const name = `capture-${path.basename(ref)}`;
    if (references.has(name)) throw invalid(`two screenshots are called ${path.basename(ref)}`);
    references.set(name, data);
  }
  if (files.size === 0 || references.size === 0) throw invalid("the capture has no pages or screenshots");
  return { title: manifest.title, files, references };
}

/** Check a file's real type by its content, not its name (design 6.2). */
function checkType(rel: string, data: Buffer, kind: "page" | "asset" | "reference"): void {
  const ext = path.extname(rel).toLowerCase();
  if (kind === "page") {
    if (ext === ".html" || ext === ".css" || ext === ".json") {
      if (!isUtf8(data) || data.includes(0)) throw invalid(`not text: ${rel}`);
      return;
    }
    throw invalid(`unexpected page file: ${rel}`);
  }
  if (kind === "reference") {
    if (!png(data)) throw invalid(`the screenshot is not a PNG: ${rel}`);
    return;
  }
  if (png(data) || jpeg(data) || gif(data) || webp(data)) return;
  if (ext === ".svg" || looksSvg(data)) {
    if (!isUtf8(data)) throw invalid(`the SVG is not text: ${rel}`);
    return;
  }
  if (ext === ".woff" && data.subarray(0, 4).toString("ascii") === "wOFF") return;
  if (ext === ".woff2" && data.subarray(0, 4).toString("ascii") === "wOF2") return;
  if (
    ext === ".ttf" &&
    (data.subarray(0, 4).toString("hex") === "00010000" || data.subarray(0, 4).toString("ascii") === "true")
  )
    return;
  if (ext === ".otf" && data.subarray(0, 4).toString("ascii") === "OTTO") return;
  throw invalid(`the file type is not allowed: ${rel}`);
}

/** A best-effort clean-up for captured SVG: no scripts, no external references (design 6.2). */
export function cleanSvg(text: string): string {
  if (/<!doctype|<!entity/i.test(text)) throw invalid("the SVG has a document type or entity");
  return (
    text
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
      .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "")
      // Animation elements can set href (or any attribute) to javascript:; a captured asset does not need them.
      .replace(/<(set|animate|animateMotion|animateTransform|discard|handler|listener)\b[^>]*\/>/gi, "")
      .replace(/<(set|animate|animateMotion|animateTransform|discard|handler|listener)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/@import[^;]+;/gi, "")
      // Only fragments stay as links; quoted, unquoted and entity-encoded external values are all removed.
      .replace(
        /\s(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
        (match, dq?: string, sq?: string, uq?: string) => ((dq ?? sq ?? uq ?? "").trim().startsWith("#") ? match : ""),
      )
      // The same rule for CSS urls: local fragments and data: images only.
      .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (match, dq?: string, sq?: string, uq?: string) => {
        const value = (dq ?? sq ?? uq ?? "").trim();
        return value.startsWith("#") || /^data:/i.test(value) ? match : "none";
      })
      // An HTML parser also takes `/` before an attribute (`<svg/onload=…>`), so handlers go after either.
      .replace(/[\s/]on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
  );
}

function png(data: Buffer): boolean {
  return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}
function jpeg(data: Buffer): boolean {
  return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}
function gif(data: Buffer): boolean {
  const head = data.subarray(0, 6).toString("ascii");
  return head === "GIF87a" || head === "GIF89a";
}
function webp(data: Buffer): boolean {
  return (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  );
}
function looksSvg(data: Buffer): boolean {
  return data.subarray(0, 512).toString("utf8").trimStart().startsWith("<svg");
}

function missing(): SiteError {
  return new SiteError("theme.capture_missing", 409);
}

function invalid(detail: string): SiteError {
  return new SiteError("theme.capture_invalid", 400, { detail });
}
