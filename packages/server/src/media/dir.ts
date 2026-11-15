import fs from "node:fs";
import path from "node:path";
import { segmentKey } from "../agent/gate.ts";
import { isRecord } from "../bukit/guard.ts";
import { BUILD_DIRS } from "../sites/exclude.ts";
import { SiteError } from "../sites/location.ts";

const within = (p: string, base: string) => p === base || p.startsWith(base + path.sep);
const unsafe = () => new SiteError("media.dir_unsafe", 409);
const invalid = () => new SiteError("media.config_invalid", 409);

/** A URL for an uploaded file: normalize baseUrl to end in "/" before concatenating (design 2.1). */
export function mediaUrl(baseUrl: unknown, name: string): string {
  const value = typeof baseUrl === "string" && baseUrl.trim() !== "" ? baseUrl.trim() : "/";
  const raw = value.startsWith("/") ? value : `/${value}`;
  const withSlash = raw.endsWith("/") ? raw : `${raw}/`;
  return `${withSlash}uploads/${name}`;
}

/** The upload directory from site.yaml; the theme rules mirror Bukit's BuildPathUtils (design 2.1). */
export function mediaDir(cwd: string, config: Record<string, unknown>): string {
  const theme = isRecord(config.theme) ? config.theme : {};
  const name = theme.name;
  if (typeof name !== "string" || name.trim() === "" || name.includes("\0")) throw invalid();
  const themeDir = path.resolve(cwd, "themes", name);
  if (!within(themeDir, cwd)) throw unsafe();
  const themeStat = fs.lstatSync(themeDir, { throwIfNoEntry: false });
  if (themeStat?.isSymbolicLink()) throw unsafe();
  if (!themeStat?.isDirectory()) throw invalid();

  const staticValue = theme.static;
  if (staticValue !== undefined && staticValue !== null && typeof staticValue !== "string") throw invalid();
  if (staticValue === "") throw invalid();
  const staticDir =
    staticValue === undefined || staticValue === null || staticValue.toLowerCase() === "static"
      ? path.join(themeDir, "static")
      : path.resolve(cwd, staticValue);
  const uploadDir = path.join(staticDir, "uploads");
  if (!within(uploadDir, cwd)) throw unsafe();
  return uploadDir;
}

/** Reject any existing symbolic link in the path from the checkout root to `target`. */
export function assertNoSymlinks(cwd: string, target: string): void {
  const relative = path.relative(cwd, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw unsafe();
  let current = cwd;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat) break;
    if (stat.isSymbolicLink()) throw unsafe();
  }
}

/** The same protected-path rules as the AI gate, including .env at every level (design 4.2 #8). */
export function assertSafePath(cwd: string, target: string): void {
  const parts = path.relative(cwd, target).split(path.sep).filter(Boolean);
  const keys = parts.map(segmentKey);
  if (keys[0] !== undefined && (BUILD_DIRS.some((d) => segmentKey(d) === keys[0]) || keys[0] === "plugins")) {
    throw unsafe();
  }
  if (keys.includes("node_modules") || keys.includes(".git") || keys.some((key) => key.startsWith(".env"))) {
    throw unsafe();
  }
}
