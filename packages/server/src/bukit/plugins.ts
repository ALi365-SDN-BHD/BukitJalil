import { BUKIT_BUILTIN_PLUGINS, type BukitPluginId, type BukitPluginState } from "@bukitjalil/shared";
import { type Document, isMap, type YAMLMap } from "yaml";
import { isRecord } from "./guard.ts";

/** Effective state of the built-in plugins in a parsed site.yaml (plan 8.5). */
export function pluginStatesFromConfig(config: Record<string, unknown>): BukitPluginState[] | null {
  const site = isRecord(config.site) ? config.site : null;
  if (!site) return null;
  const raw = site.plugins;
  if (raw === undefined || raw === null) return BUKIT_BUILTIN_PLUGINS.map(({ id }) => defaultState(id));
  if (!isRecord(raw)) return null;

  const entries = new Map<string, unknown>();
  for (const [name, value] of Object.entries(raw)) entries.set(name.trim().toLowerCase(), value);
  const states: BukitPluginState[] = [];
  for (const { id } of BUKIT_BUILTIN_PLUGINS) {
    if (!entries.has(id)) {
      states.push(defaultState(id));
      continue;
    }
    const value = entries.get(id);
    if (typeof value === "boolean") {
      states.push({ id, enabled: value, configured: true });
      continue;
    }
    if (!isRecord(value)) return null;
    const enabled = value.enabled;
    if (enabled !== undefined && typeof enabled !== "boolean") return null;
    states.push({ id, enabled: enabled ?? true, configured: true });
  }
  return states;
}

/** The same state for a YAML document that is about to be edited; null when site/plugins is invalid. */
export function pluginStateFromDocument(
  doc: Document.Parsed,
  id: BukitPluginId,
): { enabled: boolean; configured: boolean } | null {
  const site = doc.get("site");
  if (!isMap(site)) return null;
  const plugins = site.get("plugins");
  if (plugins === undefined || plugins === null) return { enabled: true, configured: false };
  if (!isMap(plugins)) return null;
  const value = pluginValue(plugins, id);
  if (value === undefined) return { enabled: true, configured: false };
  if (typeof value === "boolean") return { enabled: value, configured: true };
  if (!isMap(value)) return null;
  const enabled = value.get("enabled");
  if (enabled !== undefined && typeof enabled !== "boolean") return null;
  return { enabled: enabled ?? true, configured: true };
}

/** Set site.plugins.<id>; keeps an existing options map and its comments. */
export function setPluginInDocument(doc: Document.Parsed, id: BukitPluginId, enabled: boolean): void {
  const site = doc.get("site");
  if (!isMap(site)) throw new Error("site is not a mapping");
  let plugins = site.get("plugins");
  if (plugins === undefined || plugins === null) {
    doc.setIn(["site", "plugins"], doc.createNode({}));
    plugins = site.get("plugins");
  }
  if (!isMap(plugins)) throw new Error("site.plugins is not a mapping");
  const key = pluginKey(plugins, id) ?? id;
  const value = plugins.get(key);
  if (isMap(value)) doc.setIn(["site", "plugins", key, "enabled"], enabled);
  else doc.setIn(["site", "plugins", key], enabled);
}

/** The actual key of a plugin, matching Bukit's trimmed, case-insensitive names; the last one wins. */
function pluginKey(plugins: YAMLMap, id: BukitPluginId): string | undefined {
  let found: string | undefined;
  for (const pair of plugins.items) {
    const key = pair.key;
    const name =
      typeof key === "string"
        ? key
        : key && typeof key === "object" && "value" in key
          ? String((key as { value: unknown }).value)
          : "";
    if (name.trim().toLowerCase() === id) found = name;
  }
  return found;
}

function pluginValue(plugins: YAMLMap, id: BukitPluginId): unknown {
  const key = pluginKey(plugins, id);
  return key === undefined ? undefined : plugins.get(key);
}

const defaultState = (id: BukitPluginId): BukitPluginState => ({ id, enabled: true, configured: false });
