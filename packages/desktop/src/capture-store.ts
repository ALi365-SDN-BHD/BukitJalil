import fs from "node:fs";
import path from "node:path";

/** A capture the user did not turn into a theme project within this time is removed (design 6.2). */
export const CAPTURE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Remove captures older than `maxAgeMs` from `<app data>/captures`. The server deletes a capture once it
 * became a theme project; one left behind (the dialog closed, creating failed and was not retried) still
 * holds the captured pages, so it does not stay in the app data folder for good. Only capture folders are
 * touched, never links or other files.
 */
export function pruneCaptures(dir: string, maxAgeMs = CAPTURE_MAX_AGE_MS, now = Date.now()): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9a-f]{32}$/.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    try {
      if (now - fs.lstatSync(full).mtimeMs > maxAgeMs) fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // another process removed it, or it cannot be read: try again next time
    }
  }
}
