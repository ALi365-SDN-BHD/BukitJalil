import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

/** A site config is small; a larger YAML file is not read (same bound as the pre-build guard). */
const MAX_CONFIG_BYTES = 1024 * 1024;
/** A folder with more root YAML files than this is not scanned further. */
const MAX_FILES = 200;

/**
 * Whether YAML text is a Bukit site config, judged by content only: a top-level `site` mapping and a
 * top-level `theme` key. The file's name plays no part.
 */
export function looksLikeSiteConfig(text: string): boolean {
  const doc = parseDocument(text, { schema: "failsafe", uniqueKeys: true });
  if (doc.errors.length > 0) return false;
  const root = doc.toJS({ maxAliasCount: 0 }) as unknown;
  if (typeof root !== "object" || root === null || Array.isArray(root)) return false;
  const top = root as Record<string, unknown>;
  const site = top.site;
  return typeof site === "object" && site !== null && !Array.isArray(site) && "theme" in top;
}

/**
 * Regular *.yaml / *.yml files directly in `dir` whose content is a site config. Symbolic links and
 * files over 1 MiB are skipped; nothing is written.
 */
export function findConfigCandidates(dir: string): string[] {
  const found: string[] = [];
  let seen = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!/\.ya?ml$/i.test(entry.name)) continue;
    if (++seen > MAX_FILES) break;
    const file = path.join(dir, entry.name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) continue;
      if (looksLikeSiteConfig(fs.readFileSync(file, "utf8"))) found.push(entry.name);
    } catch {
      // Unreadable or not UTF-8: not a candidate.
    }
  }
  return found.sort();
}
