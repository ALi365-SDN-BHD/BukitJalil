import fs from "node:fs";
import path from "node:path";
import type { AppPaths } from "../paths.ts";

/**
 * What a reset after a forgotten PIN deletes (plan 6.9): the database and everything kept per site that
 * came from it. The user's site and theme folders are elsewhere and stay; logs hold no secrets and stay.
 */
export function resetTargets(paths: AppPaths): string[] {
  return [
    paths.db,
    `${paths.db}-wal`,
    `${paths.db}-shm`,
    paths.worktrees,
    paths.previews,
    paths.notionSnapshots,
    paths.captures,
    paths.tmp,
  ];
}

/**
 * Delete them. Runs at the start of a server started with --reset, after it holds the data directory's
 * lock and before anything opens the database, so no running task can write into what is deleted.
 * Only entries inside the data directory are touched; a symlink is removed, never followed.
 */
export function resetAppData(paths: AppPaths): void {
  const home = path.resolve(paths.home);
  for (const target of resetTargets(paths)) {
    if (path.dirname(path.resolve(target)) !== home) throw new Error(`refusing to reset ${target}`);
    fs.rmSync(target, { recursive: true, force: true });
  }
}
