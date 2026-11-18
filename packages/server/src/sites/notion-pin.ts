import { isRecord } from "../bukit/guard.ts";
import { sourceTypeOf } from "../changes/notion-config.ts";

/**
 * The Notion keys an offline build takes from the formal build instead of the unreviewed site.yaml
 * (plan 5.5, Bukit `--notion-pin`): the ones that choose which fields, pages and bodies reach templates.
 * Each source also carries its `databaseId`: Bukit fails a source whose database differs, so renaming
 * sources cannot move one source's settings onto another database.
 */
const PINNED_STRINGS = [
  "filterProperty",
  "filterType",
  "filterValue",
  "sortProperty",
  "sortDirection",
  "includeSlugProperty",
] as const;

export interface NotionPin {
  format: 1;
  sources: Record<string, Record<string, unknown>>;
}

/**
 * The `--notion-pin` file for a site.yaml parsed with every scalar as text (`parseYaml(..., { asText: true })`).
 * Sources are keyed the way Bukit keys them: the trimmed `name`, else the type, numbered (`notion1`,
 * `notion2`) when several unnamed sources share it. A key site.yaml leaves out stays out, so Bukit applies
 * its own default, as it did for the formal build.
 */
export function notionPinFrom(config: unknown): NotionPin {
  const content = isRecord(config) && isRecord(config.content) ? config.content : {};
  const sources = (Array.isArray(content.sources) ? content.sources : []).filter(isRecord);
  const types = sources.map((source) => sourceTypeOf(source) ?? "");
  const counts = new Map<string, number>();
  for (const type of types) if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
  const seen = new Map<string, number>();
  const pinned: Record<string, Record<string, unknown>> = {};
  for (const [i, source] of sources.entries()) {
    const type = types[i] ?? "";
    let key = typeof source.name === "string" ? source.name.trim() : "";
    if (!key && type && (counts.get(type) ?? 0) > 1) {
      seen.set(type, (seen.get(type) ?? 0) + 1);
      key = `${type}${seen.get(type)}`;
    } else if (!key) key = type;
    if (type !== "notion" || !isRecord(source.notion)) continue;
    pinned[key] = pinnedKeys(source.notion);
  }
  return { format: 1, sources: pinned };
}

function pinnedKeys(notion: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { databaseId: typeof notion.databaseId === "string" ? notion.databaseId : "" };
  const render = typeof notion.renderContent === "string" ? notion.renderContent.trim().toLowerCase() : "";
  if (render === "true" || render === "false") out.renderContent = render === "true";
  for (const key of PINNED_STRINGS) if (typeof notion[key] === "string") out[key] = notion[key];
  if (isRecord(notion.fieldPolicy)) {
    const policy: Record<string, unknown> = {};
    if (typeof notion.fieldPolicy.mode === "string") policy.mode = notion.fieldPolicy.mode;
    const allowed = stringList(notion.fieldPolicy.allowed);
    if (allowed) policy.allowed = allowed;
    out.fieldPolicy = policy;
  }
  if (isRecord(notion.propertyMap)) {
    out.propertyMap = Object.fromEntries(
      Object.entries(notion.propertyMap).filter(([, value]) => typeof value === "string"),
    );
  }
  const slugs = stringList(notion.includeSlugs);
  if (slugs) out.includeSlugs = slugs;
  if (typeof notion.maxItems === "string" && /^-?\d+$/.test(notion.maxItems.trim())) {
    out.maxItems = Number.parseInt(notion.maxItems, 10);
  }
  return out;
}

const stringList = (value: unknown): string[] | null =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
