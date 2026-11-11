import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ErrorCode, FsDirsResponse } from "@bukitjalil/shared";
import { GitError } from "../git/run.ts";

/** An expected failure with an API error code (plan 10.1); the route maps it to a JSON error. */
export class SiteError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: 400 | 404 | 409 | 503,
    readonly params: Record<string, string> = {},
  ) {
    super(code);
    this.name = "SiteError";
  }
}

/**
 * The API error behind `err`, when it is one the user can act on: a SiteError, or a repository whose config
 * stopped passing the allowlist (plan 7.3) on any git call, not only in the services that check first.
 */
export function asSiteError(err: unknown): SiteError | null {
  if (err instanceof SiteError) return err;
  if (err instanceof GitError && (err.kind === "unsafe_repo" || err.kind === "dubious_ownership")) {
    return new SiteError("site.repo_unsafe", 409);
  }
  return null;
}

/**
 * Real path of `p` even when its last parts do not exist yet: the deepest existing ancestor is resolved
 * through symlinks and the rest appended, so "~/Sites/new" and a symlinked "~/link/new" compare correctly.
 */
export function realPathOf(p: string): string {
  const missing: string[] = [];
  let current = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

export const inside = (child: string, parent: string) => child === parent || child.startsWith(`${parent}${path.sep}`);

export interface LocationRules {
  /** App data directory (~/.bukitjalil). */
  appHome: string;
  /** The user's home directory. */
  userHome?: string;
  /** Registered sites, to refuse overlaps. */
  sites: { name: string; path: string }[];
}

/**
 * Where a site may live (plan 5.2): not the root or the home directory itself, not in or around the app
 * data directory, and not inside or around another registered site. Returns the real path.
 */
export function checkSiteLocation(target: string, rules: LocationRules): string {
  if (!path.isAbsolute(target)) throw new SiteError("site.path_forbidden", 400, { reason: "relative" });
  const real = realPathOf(target);
  const home = realPathOf(rules.userHome ?? os.homedir());
  const appHome = realPathOf(rules.appHome);
  if (real === path.parse(real).root) throw new SiteError("site.path_forbidden", 400, { reason: "root" });
  if (real === home) throw new SiteError("site.path_forbidden", 400, { reason: "home" });
  if (inside(real, appHome) || inside(appHome, real)) {
    throw new SiteError("site.path_forbidden", 400, { reason: "app_data" });
  }
  for (const site of rules.sites) {
    const other = realPathOf(site.path);
    if (real === other) throw new SiteError("site.already_registered", 409);
    if (inside(real, other) || inside(other, real)) {
      throw new SiteError("site.path_overlaps_site", 409, { site: site.name });
    }
  }
  return real;
}

/** A new site's directory must not exist or be an empty directory. */
export function assertEmptyOrMissing(real: string): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(real);
  } catch {
    return;
  }
  if (!st.isDirectory() || fs.readdirSync(real).length > 0) throw new SiteError("site.path_not_empty", 409);
}

/** An existing directory, for import. */
export function assertDirectory(real: string): void {
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    throw new SiteError("fs.not_found", 404);
  }
  if (!st.isDirectory()) throw new SiteError("fs.not_directory", 400);
}

/**
 * Directory picker (plan 5.2, `GET /api/fs/dirs`): names of the subdirectories one level below `dir`.
 * Files are never listed and symlinks are not followed; hidden directories only when asked.
 */
export function listDirs(dir: string | undefined, opts: { hidden?: boolean; userHome?: string } = {}): FsDirsResponse {
  const requested = dir && dir.length > 0 ? dir : (opts.userHome ?? os.homedir());
  if (!path.isAbsolute(requested)) throw new SiteError("fs.not_found", 404);
  let real: string;
  let entries: fs.Dirent[];
  try {
    real = fs.realpathSync(requested);
    if (!fs.statSync(real).isDirectory()) throw new SiteError("fs.not_directory", 400);
    entries = fs.readdirSync(real, { withFileTypes: true });
  } catch (err) {
    if (err instanceof SiteError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") throw new SiteError("fs.permission_denied", 400);
    if (code === "ENOTDIR") throw new SiteError("fs.not_directory", 400);
    throw new SiteError("fs.not_found", 404);
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && (opts.hidden || !e.name.startsWith(".")))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const parent = path.dirname(real);
  return { path: real, parent: parent === real ? null : parent, dirs };
}
