import { describe, expect, it } from "vitest";
import { parseYaml } from "../src/panels/yaml.ts";
import { notionPinFrom } from "../src/sites/notion-pin.ts";

const pinOf = (yaml: string) => {
  const parsed = parseYaml(yaml, { asText: true });
  if (parsed.error !== null) throw new Error(parsed.error);
  return notionPinFrom(parsed.value);
};

describe("notionPinFrom", () => {
  it("keeps the field, filter and body keys of each Notion source, keyed like Bukit", () => {
    const pin = pinOf(`
content:
  sources:
    - type: notion
      notion:
        databaseId: 123
        renderContent: "False"
        maxItems: 20
        fieldPolicy: { mode: whitelist, allowed: [Tags] }
        propertyMap: { Title: Name, PublishAt: Date }
        filterType: none
        cacheMode: readwrite
    - type: markdown
      markdown: { dir: content }
    - type: Notion
      name: "  "
      notion: { databaseId: abc }
    - type: notion
      name: news
      notion: { databaseId: def, includeSlugs: [a, b] }
`);
    expect(pin).toEqual({
      format: 1,
      sources: {
        notion1: {
          databaseId: "123",
          renderContent: false,
          maxItems: 20,
          fieldPolicy: { mode: "whitelist", allowed: ["Tags"] },
          propertyMap: { Title: "Name", PublishAt: "Date" },
          filterType: "none",
        },
        notion2: { databaseId: "abc" },
        news: { databaseId: "def", includeSlugs: ["a", "b"] },
      },
    });
  });

  it("has no sources for a site without Notion", () => {
    expect(pinOf("content:\n  sources:\n    - type: markdown\n")).toEqual({ format: 1, sources: {} });
    expect(pinOf("site: { name: x }\n")).toEqual({ format: 1, sources: {} });
  });
});
