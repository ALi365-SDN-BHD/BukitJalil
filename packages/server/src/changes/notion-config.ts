import { isDeepStrictEqual } from "node:util";
import type { NotionConfigChange } from "@bukitjalil/shared";
import { isRecord } from "../bukit/guard.ts";
import { readBlobAt } from "../git/objects.ts";
import { GitError, type GitRunner } from "../git/run.ts";
import { parseYaml } from "../panels/yaml.ts";

const MAX_SITE_YAML = 1024 * 1024;
const MAX_CHANGES = 50;
const MAX_TEXT = 200;

/**
 * The type of a content source the way Bukit 2.0.15 reads it: `type` compared without case, else inferred
 * from a `markdown` or `notion` section.
 */
export function sourceTypeOf(source: Record<string, unknown>): string | null {
  if (typeof source.type === "string") return source.type.trim().toLowerCase();
  return isRecord(source.markdown) ? "markdown" : isRecord(source.notion) ? "notion" : null;
}

/**
 * Whether a source may read Notion: the same rule as the build guard (a Notion type or any `notion`
 * section), so the review card never misses a source the build passes the token to.
 */
export function mayReadNotion(source: Record<string, unknown>): boolean {
  return sourceTypeOf(source) === "notion" || isRecord(source.notion);
}

/**
 * The Notion sources of a parsed site.yaml, by name; a source without a name is keyed by its position
 * ("#<n>"). Bukit refuses two sources with the same name, but a named source can still be called "#1",
 * so a key that is already taken gets the position added rather than hiding either source.
 */
export function notionSources(config: unknown): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  const content = isRecord(config) && isRecord(config.content) ? config.content : {};
  const sources = Array.isArray(content.sources) ? content.sources : [];
  for (const [i, source] of sources.entries()) {
    if (!isRecord(source) || !mayReadNotion(source)) continue;
    let key = typeof source.name === "string" && source.name.trim() ? source.name.trim() : `#${i + 1}`;
    if (out.has(key)) key = `${key} (#${i + 1})`;
    out.set(key, isRecord(source.notion) ? source.notion : {});
  }
  return out;
}

const idOf = (notion: Record<string, unknown> | undefined) =>
  notion && typeof notion.databaseId === "string" ? notion.databaseId.slice(0, MAX_TEXT) : null;

/**
 * What changes between two site.yaml configs in their Notion sources (plan 5.4): sources added or removed,
 * a different databaseId, other keys of the `notion` section by name.
 */
export function notionConfigChanges(before: unknown, after: unknown): NotionConfigChange[] {
  const a = notionSources(before);
  const b = notionSources(after);
  const changes: NotionConfigChange[] = [];
  for (const [source, notion] of b) {
    const old = a.get(source);
    if (!old) {
      changes.push({ source, change: "added", databaseId: { before: null, after: idOf(notion) }, keys: [] });
      continue;
    }
    const keys = [...new Set([...Object.keys(old), ...Object.keys(notion)])]
      .filter((k) => k !== "databaseId" && !isDeepStrictEqual(old[k], notion[k]))
      .sort()
      .map((k) => k.slice(0, MAX_TEXT));
    const idChanged = idOf(old) !== idOf(notion);
    if (!idChanged && keys.length === 0) continue;
    changes.push({
      source,
      change: "changed",
      ...(idChanged ? { databaseId: { before: idOf(old), after: idOf(notion) } } : {}),
      keys,
    });
  }
  for (const [source, notion] of a) {
    if (!b.has(source)) {
      changes.push({ source, change: "removed", databaseId: { before: idOf(notion), after: null }, keys: [] });
    }
  }
  return changes.slice(0, MAX_CHANGES).map((c) => ({ ...c, source: c.source.slice(0, MAX_TEXT) }));
}

const UNREADABLE = Symbol("unreadable");

/** site.yaml at `commit`, parsed with every value as text; null when missing, UNREADABLE when it can't be read. */
async function configAt(git: GitRunner, cwd: string, commit: string): Promise<unknown> {
  try {
    const raw = await readBlobAt(git, cwd, commit, "site.yaml", MAX_SITE_YAML);
    if (!raw) return null;
    const parsed = parseYaml(raw.toString("utf8"), { asText: true });
    return parsed.error === null ? parsed.value : UNREADABLE;
  } catch (err) {
    if (err instanceof GitError) return UNREADABLE;
    throw err;
  }
}

/**
 * The Notion config changes from `base` to `head` (both commits of the site's repository). When the
 * change's site.yaml can't be read (too large, not YAML) the list says so instead of calling every
 * source removed; an unreadable base is compared as empty, so every Notion source shows as added.
 */
export async function notionChangesBetween(
  git: GitRunner,
  cwd: string,
  base: string,
  head: string,
): Promise<NotionConfigChange[]> {
  const [before, after] = await Promise.all([configAt(git, cwd, base), configAt(git, cwd, head)]);
  if (after === UNREADABLE) return [{ source: "site.yaml", change: "unreadable", keys: [] }];
  return notionConfigChanges(before === UNREADABLE ? null : before, after);
}
