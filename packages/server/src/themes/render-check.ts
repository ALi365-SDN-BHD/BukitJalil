import fs from "node:fs";
import path from "node:path";
import type { ProjectKey } from "@bukitjalil/shared";
import { NoPreviewPortError, type PreviewPool, previewUrl } from "../preview/pool.ts";

/**
 * The render check of a theme project (plan 14, borrowing from taste skill, D3): serve a build of the AI's
 * working copy on a preview port of its own, have the desktop app render a few pages at four widths, and
 * turn what it found into a short list for the AI. Only the desktop app can render, so only it has this.
 */

export const RENDER_WIDTHS = [320, 390, 768, 1280];
const MAX_PAGES = 6;
const MAX_TEXT = 300;
/** Findings listed in all; more would crowd the model's context. */
const MAX_ISSUES = 40;
const RULES = new Set(["overflow", "tap_target", "headings", "focus_ring", "overlap"]);

export interface RenderFinding {
  page: string;
  rule: string;
  element: string;
  detail: string;
  /** The widths it was found at. */
  widths: number[];
}

export type RenderCheckOutcome =
  | { ok: true; pages: { page: string; widths: number[] }[]; issues: RenderFinding[]; notes: string[] }
  | { ok: false; error: string };

/** Asks the desktop app to render and check pages (desktop.ts requestRenderCheck). */
export type RenderRequest = (urls: string[], widths: number[]) => Promise<{ pages: unknown; error: string | null }>;

export type RenderChecker = (args: {
  project: ProjectKey;
  /** The build output. */
  root: string;
  /** The path the build is served under ("/" or "/a/b/"). */
  basePath: string;
  /** Pages to check, as paths in the build ("blog/a-post/"); the default picks a few. */
  pages?: string[];
  /** Stops waiting for the desktop app (the run was stopped); the port closes and its loads fail. */
  signal?: AbortSignal;
}) => Promise<RenderCheckOutcome>;

export function createRenderChecker(opts: { previews: PreviewPool; request: RenderRequest }): RenderChecker {
  return async ({ project, root, basePath, pages, signal }) => {
    const chosen = pages && pages.length > 0 ? checkPages(root, pages) : pickRenderPages(root);
    if (typeof chosen === "string") return { ok: false, error: chosen };
    if (chosen.length === 0) return { ok: false, error: "The build has no pages to check." };
    const key = `${project}:render`;
    let port: number;
    try {
      ({ port } = await opts.previews.open(key, root, undefined, basePath));
    } catch (err) {
      if (err instanceof NoPreviewPortError) return { ok: false, error: "No free preview port for the check." };
      throw err;
    }
    try {
      const urls = chosen.map((p) => `${previewUrl(port, basePath)}${p}`);
      const stopped = new Promise<null>((resolve) => {
        if (signal?.aborted) resolve(null);
        signal?.addEventListener("abort", () => resolve(null), { once: true });
      });
      const answer = await Promise.race([opts.request(urls, RENDER_WIDTHS), stopped]);
      if (answer === null) return { ok: false, error: "The check was stopped." };
      const { pages: raw, error } = answer;
      if (error !== null) return { ok: false, error: `The desktop app could not check the pages: ${error}` };
      return summarize(raw, urls, chosen);
    } finally {
      await opts.previews.close(key, { force: true });
    }
  };
}

/**
 * The pages a theme is usually judged by: the home page, a post, a list with more pages and the style guide
 * of the sample content, when the build has them.
 */
export function pickRenderPages(root: string): string[] {
  const html = htmlFiles(root);
  const has = new Set(html);
  const pages: string[] = [];
  if (has.has("index.html")) pages.push("");
  const list = html.find((p) => /(^|\/)page\/2\/index\.html$/.test(p));
  if (list) pages.push(list.replace(/page\/2\/index\.html$/, ""));
  const skip = /(^|\/)(page|archive|tags|categories|pages)\//;
  const post = html.find((p) => p.split("/").length >= 3 && p.endsWith("/index.html") && !skip.test(p));
  if (post) pages.push(post.replace(/index\.html$/, ""));
  if (has.has("pages/style-guide/index.html")) pages.push("pages/style-guide/");
  return [...new Set(pages)];
}

/** The pages the AI asked for, each a page of the build; or what is wrong with them. */
function checkPages(root: string, pages: string[]): string[] | string {
  const has = new Set(htmlFiles(root));
  const out: string[] = [];
  for (const raw of pages.slice(0, MAX_PAGES)) {
    const page = raw.replace(/^\/+/, "");
    if (page.split("/").some((s) => s === ".." || s === ".")) return `Not a page of the build: ${raw}`;
    const file = page === "" || page.endsWith("/") ? `${page}index.html` : page;
    if (!has.has(file)) return `Not a page of the build: ${raw}`;
    out.push(page);
  }
  return out;
}

function htmlFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const sub = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), sub);
      else if (e.isFile() && /\.html$/i.test(e.name)) out.push(sub);
    }
  };
  walk(root, "");
  return out;
}

const text = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX_TEXT) : "");

/** What the desktop app returned, checked, with each finding listed once with the widths it was seen at. */
function summarize(raw: unknown, urls: string[], pages: string[]): RenderCheckOutcome {
  if (!Array.isArray(raw)) return { ok: false, error: "The desktop app returned no result." };
  const issues = new Map<string, RenderFinding>();
  const checked: { page: string; widths: number[] }[] = [];
  const notes: string[] = [];
  urls.forEach((url, i) => {
    const page = `/${pages[i] ?? ""}`;
    const entry = raw.find((r): r is { url: string; results: unknown } => r?.url === url);
    const results = Array.isArray(entry?.results) ? entry.results : [];
    const widths: number[] = [];
    results.forEach((result: { width?: unknown; issues?: unknown }, w) => {
      const width = typeof result?.width === "number" ? result.width : 0;
      widths.push(width);
      const asked = RENDER_WIDTHS[w];
      if (asked !== undefined && width !== asked)
        notes.push(`${page} was checked ${width}px wide instead of ${asked}px (the window could not be that size).`);
      for (const issue of Array.isArray(result?.issues) ? result.issues : []) {
        const rule = text(issue?.rule);
        if (!RULES.has(rule)) continue;
        const finding = { page, rule, element: text(issue?.element), detail: text(issue?.detail) };
        // Sizes and the window width differ from width to width; the first width's wording is kept.
        const key = JSON.stringify({ ...finding, detail: finding.detail.replace(/\d+(\.\d+)?px/g, "px") });
        const seen = issues.get(key);
        if (seen) seen.widths.push(width);
        else issues.set(key, { ...finding, widths: [width] });
      }
    });
    checked.push({ page, widths });
  });
  const all = [...issues.values()];
  if (all.length > MAX_ISSUES)
    notes.push(`${all.length - MAX_ISSUES} more issues are not listed; fix these and check again.`);
  return { ok: true, pages: checked, issues: all.slice(0, MAX_ISSUES), notes: [...new Set(notes)] };
}
