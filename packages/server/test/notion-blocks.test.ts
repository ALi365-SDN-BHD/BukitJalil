import { describe, expect, it } from "vitest";
import {
  blocksToMarkdown,
  chunks,
  markdownToItems,
  parseInline,
  type RawBlock,
  storedOf,
} from "../src/data-sources/notion-blocks.ts";

// Plan 5.6 item 7: a page body as Markdown and back. Every supported block and inline style must come back
// unchanged, and anything else must keep the body read-only.

const roundTrip = (markdown: string) => blocksToMarkdown(storedOf(markdownToItems(markdown)));

const text = (content: string, annotations: Record<string, unknown> = {}, href: string | null = null) => ({
  type: "text",
  plain_text: content,
  href,
  text: { content, link: href ? { url: href } : null },
  annotations: {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: "default",
    ...annotations,
  },
});
const raw = (type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}): RawBlock => ({
  block: { id: "b", type, has_children: false, [type]: data, ...extra },
});

describe("body Markdown", () => {
  it.each([
    ["paragraph", "Hello world"],
    ["paragraphs and an empty one", "First\n\n&nbsp;\n\nThird"],
    ["headings", "# One\n\n## Two\n\n### Three"],
    ["lists", "- a\n- b\n1. one\n1. two\n- [ ] todo\n- [x] done"],
    ["nested list items", "- parent\n    - child\n    1. numbered child\n- next"],
    ["quote", "> a quote<br>on two lines"],
    ["code with a language", "```typescript\nconst a = `x`;\n\n```"],
    ["plain code holding a fence", "````\n```\nnot a fence\n```\n````"],
    ["divider", "Before\n\n---\n\nAfter"],
    ["external image", "![A **cat**](https://example.com/cat\\(1\\).png)"],
    ["hosted image", "![](notion-image:0123456789abcdef0123456789abcdef)"],
    ["inline styles", "**bold** _italic_ ~~strike~~ `code` [link](https://example.com/a) **_both_**"],
    ["link with styles inside", "[**bold** link](mailto:a@example.com) and ``a`b``"],
    ["escapes", "1\\. not a list \\* \\_ \\~ \\` \\[x\\] \\\\ \\<br> a<br>b"],
    ["paragraphs that look like blocks", "\\# no heading\n\n\\- no list\n\n\\> no quote\n\n\\---\n\n\\&nbsp;"],
    ["emoji and CJK", "中文 **粗体** 😀"],
    ["a paragraph of spaces and &nbsp;", "  \\&nbsp;"],
    ["a caption with a link", "![a [link](https://example.com/x) here](notion-image:0123456789abcdef0123456789abcdef)"],
    ["code of spaces", "` ` and `  `"],
    ["a paragraph of ! and a link", "\\![docs](https://example.com/a)"],
    ["a link around code holding a bracket", "see [`arr[0]` and `]`](https://example.com/a) here"],
  ])("keeps %s unchanged", (_name, markdown) => {
    expect(roundTrip(markdown)).toEqual({ markdown, unsupported: [] });
  });

  it("writes what Notion stores, with inline styles as annotations", () => {
    expect(markdownToItems("- [x] **Done** [here](https://example.com)\n    - child")).toEqual([
      {
        kind: "block",
        block: {
          object: "block",
          type: "to_do",
          to_do: {
            checked: true,
            rich_text: [
              expect.objectContaining({
                text: { content: "Done", link: null },
                annotations: expect.objectContaining({ bold: true }),
              }),
              expect.objectContaining({ text: { content: " ", link: null } }),
              expect.objectContaining({ text: { content: "here", link: { url: "https://example.com" } } }),
            ],
            children: [expect.objectContaining({ type: "bulleted_list_item" })],
          },
        },
      },
    ]);
    expect(markdownToItems("```\nx\n```")[0]).toMatchObject({ block: { code: { language: "plain text" } } });
    // Common fence names become Notion's language names.
    expect(markdownToItems("```JS\nx\n```")[0]).toMatchObject({ block: { code: { language: "javascript" } } });
    expect(markdownToItems("![](notion-image:0123456789ABCDEF0123456789abcdef)")).toEqual([
      { kind: "keep", id: "0123456789abcdef0123456789abcdef", caption: [] },
    ]);
  });

  it("reads natural Markdown leniently", () => {
    const read = (md: string) => blocksToMarkdown(storedOf(markdownToItems(md))).markdown;
    expect(read("line one\nline two\n\n\n* star item\n2) paren item")).toBe(
      "line one<br>line two\n\n- star item\n1. paren item",
    );
    expect(read("2*3")).toBe("2\\*3");
    expect(read("an **unclosed bold")).toBe("an \\*\\*unclosed bold");
    expect(read("[not a link](javascript:alert(1))")).toBe("\\[not a link\\](javascript:alert(1))");
  });

  it("refuses what Notion would not take", () => {
    expect(() => markdownToItems("![x](ftp://example.com/a.png)")).toThrow("content.body_invalid");
    expect(() => markdownToItems("```klingon\nx\n```")).toThrow("content.body_invalid");
    expect(() => markdownToItems("![x](notion-image:nothex)")).toThrow("content.body_invalid");
    // A line that only starts like an image is not one with a strange caption.
    expect(() => markdownToItems("![x](a) and [b](https://c.example)")).toThrow("content.body_invalid");
    expect(() => markdownToItems("![x](https://a.example)(b)")).toThrow("content.body_invalid");
    // One level of nesting only.
    expect(() => markdownToItems("- a\n    - b\n        - c")).toThrow("content.body_invalid");
    // More than 100 rich text items in one block.
    expect(() => markdownToItems(Array.from({ length: 101 }, (_, i) => (i % 2 ? "**b**" : "a")).join(""))).toThrow(
      "content.body_invalid",
    );
  });

  it("splits long text at 2000 characters", () => {
    expect(chunks("x".repeat(4001)).map((c) => c.length)).toEqual([2000, 2000, 1]);
    const [paragraph] = markdownToItems("y".repeat(2500));
    expect(paragraph).toMatchObject({ block: { paragraph: { rich_text: [{}, {}] } } });
  });

  it("names what keeps a body read-only", () => {
    const result = blocksToMarkdown([
      raw("paragraph", { rich_text: [text("x", { underline: true })] }),
      raw("paragraph", { rich_text: [{ type: "mention", plain_text: "@Ana" }], color: "red" }),
      raw("heading_2", { rich_text: [text("t")], is_toggleable: true }),
      raw("toggle", { rich_text: [text("t")] }),
      raw("paragraph", { rich_text: [text("x", {}, "/0123456789abcdef0123456789abcdef")] }),
      raw("paragraph", { rich_text: [text("x")] }, { has_children: true }),
      raw("code", { rich_text: [text("x", { bold: true })], caption: [text("c")], language: "js" }),
      raw("image", { type: "external", external: { url: "data:image/png;base64,x" }, caption: [] }),
      {
        block: { id: "l", type: "bulleted_list_item", has_children: true, bulleted_list_item: { rich_text: [] } },
        children: [raw("bulleted_list_item", { rich_text: [] }, { has_children: true })],
      },
      raw("table", {}),
      raw("code", { rich_text: [text("x")], caption: [], language: "klingon" }),
    ]);
    // A list item's child that is not a list item would come back out of the list.
    const nested = blocksToMarkdown([
      {
        block: { id: "l", type: "bulleted_list_item", has_children: true, bulleted_list_item: { rich_text: [] } },
        children: [raw("paragraph", { rich_text: [text("child")] })],
      },
    ]);
    expect(nested).toEqual({ markdown: "", unsupported: ["children"] });
    // More children than one request can write back.
    const many = blocksToMarkdown([
      {
        block: { id: "l", type: "bulleted_list_item", has_children: true, bulleted_list_item: { rich_text: [] } },
        children: Array.from({ length: 101 }, () => raw("bulleted_list_item", { rich_text: [text("c")] })),
      },
    ]);
    expect(many).toEqual({ markdown: "", unsupported: ["children"] });
    expect(result).toEqual({
      markdown: "",
      unsupported: [
        "caption",
        "children",
        "code_format",
        "code_language",
        "color",
        "image_url",
        "link",
        "mention",
        "table",
        "toggle",
        "underline",
      ],
    });
  });

  it("shows a Notion-hosted image by its block id", () => {
    const hosted = raw(
      "image",
      { type: "file", file: { url: "https://s3.example/signed" }, caption: [text("Cover")] },
      { id: "01234567-89ab-cdef-0123-456789abcdef" },
    );
    expect(blocksToMarkdown([hosted]).markdown).toBe("![Cover](notion-image:0123456789abcdef0123456789abcdef)");
  });

  it("parses inline Markdown into spans", () => {
    expect(parseInline("a **b _c_** `d`")).toEqual([
      { text: "a ", format: { bold: false, italic: false, strike: false, code: false, href: null } },
      { text: "b ", format: { bold: true, italic: false, strike: false, code: false, href: null } },
      { text: "c", format: { bold: true, italic: true, strike: false, code: false, href: null } },
      { text: " ", format: { bold: false, italic: false, strike: false, code: false, href: null } },
      { text: "d", format: { bold: false, italic: false, strike: false, code: true, href: null } },
    ]);
  });
});

describe("body Markdown from Notion", () => {
  it("keeps a paragraph of ! and a link a paragraph", () => {
    const md = blocksToMarkdown([
      {
        block: {
          type: "paragraph",
          paragraph: {
            rich_text: [
              { type: "text", plain_text: "!", text: { content: "!" }, annotations: {} },
              {
                type: "text",
                plain_text: "docs",
                href: "https://example.com/a",
                text: { content: "docs", link: { url: "https://example.com/a" } },
                annotations: {},
              },
            ],
          },
        },
      },
    ]).markdown;
    expect(markdownToItems(md)).toMatchObject([{ block: { type: "paragraph" } }]);
  });
});
