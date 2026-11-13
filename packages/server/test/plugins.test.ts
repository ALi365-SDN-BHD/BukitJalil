import { BUKIT_BUILTIN_PLUGINS } from "@bukitjalil/shared";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { BUILTIN_PLUGINS } from "../src/bukit/guard.ts";
import { pluginStateFromDocument, pluginStatesFromConfig, setPluginInDocument } from "../src/bukit/plugins.ts";

describe("built-in plugin states", () => {
  it("lists the effective plugins the guard accepts", () => {
    expect(BUKIT_BUILTIN_PLUGINS).toHaveLength(10);
    for (const plugin of BUKIT_BUILTIN_PLUGINS) expect(BUILTIN_PLUGINS.has(plugin.id)).toBe(true);
  });

  it("treats an absent site.plugins as all on", () => {
    const states = pluginStatesFromConfig({ site: { name: "x" } });
    expect(states).toHaveLength(10);
    expect(states?.every((s) => s.enabled && !s.configured)).toBe(true);
  });

  it("reads booleans and mappings, keeps options as configured", () => {
    const states = pluginStatesFromConfig({
      site: {
        plugins: {
          "related-content": false,
          taxonomy: { enabled: false, options: { note: "kept" } },
          analytics: { options: { provider: "x" } },
        },
      },
    });
    expect(states?.find((s) => s.id === "related-content")).toEqual({
      id: "related-content",
      enabled: false,
      configured: true,
    });
    expect(states?.find((s) => s.id === "taxonomy")).toEqual({ id: "taxonomy", enabled: false, configured: true });
    expect(states?.find((s) => s.id === "analytics")).toEqual({ id: "analytics", enabled: true, configured: true });
    expect(states?.find((s) => s.id === "pagination")).toEqual({ id: "pagination", enabled: true, configured: false });
  });

  it("rejects a non-mapping site.plugins or a non-boolean entry", () => {
    expect(pluginStatesFromConfig({ site: { plugins: [] } })).toBeNull();
    expect(pluginStatesFromConfig({ site: { plugins: { "related-content": "no" } } })).toBeNull();
    expect(pluginStatesFromConfig({ site: { plugins: { taxonomy: { enabled: "no" } } } })).toBeNull();
  });

  it("matches plugin names case-insensitively and trims them, like Bukit", () => {
    const states = pluginStatesFromConfig({
      site: { plugins: { Analytics: false, " Related-Content ": { enabled: false } } },
    });
    expect(states?.find((s) => s.id === "analytics")).toMatchObject({ enabled: false, configured: true });
    expect(states?.find((s) => s.id === "related-content")).toMatchObject({ enabled: false, configured: true });
  });

  it("edits an existing mixed-case key instead of adding a second one", () => {
    const doc = parseDocument(["site:", "  plugins:", "    Analytics: false", ""].join("\n"));
    expect(pluginStateFromDocument(doc, "analytics")).toEqual({ enabled: false, configured: true });
    setPluginInDocument(doc, "analytics", true);
    const text = doc.toString({ lineWidth: 0 });
    expect(text).toContain("Analytics: true");
    expect(text).not.toContain("analytics:");
  });

  it("reads and edits a YAML document without dropping comments or options", () => {
    const doc = parseDocument(
      [
        "site:",
        "  name: demo",
        "  title: Demo # keep this comment",
        "  plugins:",
        "    taxonomy:",
        "      enabled: true",
        "      options:",
        "        keep: yes",
        "content:",
        "  sources: []",
        "",
      ].join("\n"),
    );
    expect(pluginStateFromDocument(doc, "related-content")).toEqual({ enabled: true, configured: false });
    expect(pluginStateFromDocument(doc, "taxonomy")).toEqual({ enabled: true, configured: true });

    setPluginInDocument(doc, "related-content", false);
    setPluginInDocument(doc, "taxonomy", false);
    const text = doc.toString({ lineWidth: 0 });
    expect(text).toContain("title: Demo # keep this comment");
    expect(text).toContain("related-content: false");
    expect(text).toContain("keep: yes");
  });
});
