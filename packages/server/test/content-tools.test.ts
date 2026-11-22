import type { ContentBody, ContentDatabase, ContentEntryList, ContentPage } from "@bukitjalil/shared";
import { describe, expect, it } from "vitest";
import { createContentReadTools, MAX_RESULT_CHARS } from "../src/agent/content-tools.ts";
import type { NotionContentService } from "../src/data-sources/notion-content.ts";

// Content editor and AI design, A1: the read tools of a content conversation, over a stub of the Notion
// content service (its own tests cover Notion). The token never appears: the tools only see the service.
const SOURCE = "ds_0123456789ab";
const DB = "0123456789abcdef0123456789abcdef";
const OPEN = "11111111111111111111111111111111";
const OTHER = "22222222222222222222222222222222";

function stub(calls: string[], body: Partial<ContentBody> = {}) {
  const page = (id: string): ContentPage => ({
    id,
    databaseId: DB,
    title: `Page ${id.slice(0, 2)}`,
    url: null,
    lastEditedTime: "2026-11-22T08:00:00.000Z",
    properties: [
      { name: "Name", type: "title", value: { type: "title", text: "Hi there, all of it" }, display: "Hi…" },
      { name: "Related", type: "relation", value: null, display: "2" },
    ],
  });
  return {
    database: async (s: string, d: string): Promise<ContentDatabase> => {
      calls.push(`database ${s} ${d}`);
      return {
        id: d,
        title: "Blog",
        url: null,
        properties: [{ name: "Stage", type: "status", editable: true, options: [{ name: "Draft", color: "red" }] }],
        propertiesTruncated: false,
      };
    },
    entries: async (s: string, d: string, q: unknown): Promise<ContentEntryList> => {
      calls.push(`entries ${s} ${d} ${JSON.stringify(q)}`);
      return {
        entries: [
          { id: OPEN, title: "First", url: "https://notion.so/x", lastEditedTime: "t", cells: { Stage: "Draft" } },
        ],
        nextCursor: "next",
      };
    },
    page: async (s: string, d: string, id: string) => {
      calls.push(`page ${s} ${d} ${id}`);
      return page(id);
    },
    body: async (_s: string, _d: string, id: string): Promise<ContentBody> => {
      calls.push(`body ${id}`);
      return {
        blocks: [
          { type: "heading_1", text: [{ text: "Title" }] },
          { type: "paragraph", text: [{ text: "Hello", bold: true }] },
        ],
        editable: true,
        unsupported: [],
        lastEditedTime: "t",
        ...body,
      };
    },
  } as unknown as NotionContentService;
}

const tools = (calls: string[], current: string | null, body?: Partial<ContentBody>) =>
  Object.fromEntries(
    createContentReadTools({
      content: stub(calls, body),
      ref: { sourceId: SOURCE, databaseId: DB },
      current: () => current,
    }).map((t) => [
      t.name,
      (params: Record<string, unknown> = {}) =>
        t.execute("call", params as never, undefined, undefined as never, undefined as never),
    ]),
  );
const textOf = (r: unknown) => (r as { content: { text: string }[] }).content[0]?.text ?? "";

describe("content read tools", () => {
  it("read the fields and search entries of their own database only", async () => {
    const calls: string[] = [];
    const t = tools(calls, null);
    expect(JSON.parse(textOf(await t.read_schema?.()))).toMatchObject({
      title: "Blog",
      properties: [{ name: "Stage", editable: true }],
    });
    const found = JSON.parse(textOf(await t.search_entries?.({ search: "Fir", direction: "ascending" })));
    expect(found).toEqual({
      entries: [{ id: OPEN, title: "First", lastEditedTime: "t", cells: { Stage: "Draft" } }],
      nextCursor: "next",
    });
    expect(calls).toEqual([
      `database ${SOURCE} ${DB}`,
      `entries ${SOURCE} ${DB} {"search":"Fir","direction":"ascending"}`,
    ]);
  });

  it("read the open entry, or another by id, with its body as Markdown", async () => {
    const calls: string[] = [];
    const t = tools(calls, OPEN);
    const open = JSON.parse(textOf(await t.read_entry?.()));
    expect(open).toMatchObject({
      id: OPEN,
      open: true,
      body: "# Title\n\n**Hello**",
      bodyReadOnly: null,
      properties: [
        // The whole value of an editable property, not its shortened display text.
        { name: "Name", editable: true, value: "Hi there, all of it" },
        { name: "Related", editable: false, value: "2" },
      ],
    });
    const dashed = "22222222-2222-2222-2222-222222222222";
    expect(JSON.parse(textOf(await t.read_entry?.({ entryId: dashed })))).toMatchObject({ id: OTHER, open: false });
    expect(calls).toContain(`page ${SOURCE} ${DB} ${OTHER}`);
    await expect(t.read_entry?.({ entryId: "../x" })).rejects.toThrow(/not an entry id/);
  });

  it("say why a body cannot be read, and that no entry is open", async () => {
    const t = tools([], OPEN, { blocks: [], editable: false, unsupported: ["table"] });
    expect(JSON.parse(textOf(await t.read_entry?.()))).toMatchObject({ body: null, bodyReadOnly: ["table"] });
    await expect(tools([], null).read_entry?.()).rejects.toThrow(/no entry open/);
  });

  it("cut a result that is too long", async () => {
    const t = tools([], OPEN, { blocks: [{ type: "paragraph", text: [{ text: "x".repeat(MAX_RESULT_CHARS) }] }] });
    const text = textOf(await t.read_entry?.());
    expect(text.length).toBeLessThan(MAX_RESULT_CHARS + 100);
    expect(text).toMatch(/cut: the result is too long/);
  });
});
