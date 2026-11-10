import fs from "node:fs";
import path from "node:path";

/**
 * BukitJalil's block in a site's .git/info/exclude (plan 7.2). It has to live there rather than in a
 * -c core.excludesFile: the git that Bukit runs for multi-language builds must ignore these too.
 */
const BEGIN = "# BukitJalil begin";
const END = "# BukitJalil end";
/** Build output and caches at the top of a checkout: ignored by git, never written by the AI (plan 6.3). */
export const BUILD_DIRS = ["dist", ".bukit", ".cache", ".bukitjalil-build"] as const;
export const EXCLUDE_PATTERNS = BUILD_DIRS.map((dir) => `${dir}/`);
/** Extra patterns for a directory that was not a git repository before import (plan 5.1). */
export const IMPORT_INIT_PATTERNS = [".env*", "node_modules/"];

/** Text of `content` with our block replaced by `patterns` (or removed when `patterns` is null). */
export function withBlock(content: string, patterns: string[] | null): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === BEGIN) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (line.trim() === END) skipping = false;
      continue;
    }
    out.push(line);
  }
  let text = out.join("\n").replace(/\n+$/, "");
  if (patterns) text = `${text}${text ? "\n" : ""}${[BEGIN, ...patterns, END].join("\n")}`;
  return text ? `${text}\n` : "";
}

/** Write or replace the block in `<commonDir>/info/exclude`. */
export function writeExcludeBlock(commonDir: string, patterns: string[] = EXCLUDE_PATTERNS): void {
  const file = path.join(commonDir, "info", "exclude");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const next = withBlock(current, patterns);
  if (next !== current) fs.writeFileSync(file, next);
}

/** Remove the block again (site removal); the user's own lines stay. */
export function removeExcludeBlock(commonDir: string): void {
  const file = path.join(commonDir, "info", "exclude");
  if (!fs.existsSync(file)) return;
  const current = fs.readFileSync(file, "utf8");
  const next = withBlock(current, null);
  if (next !== current) fs.writeFileSync(file, next);
}
