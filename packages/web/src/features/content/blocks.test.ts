import type { ContentBlock } from "@bukitjalil/shared";
import { describe, expect, it } from "vitest";
import { type EditorBlock, type EditorBlockInit, fromEditor, sameBlocks, toEditor } from "./blocks";

// Plan 5.6 item 7: the body goes into the block editor and comes back as the blocks the server writes.
let next = 0;
const doc = (blocks: EditorBlockInit[]): EditorBlock[] =>
  blocks.map((b) => ({
    id: b.id ?? `b${next++}`,
    type: b.type,
    props: b.props ?? {},
    content: b.content ?? [],
    children: doc(b.children ?? []),
  }));
const roundTrip = (blocks: ContentBlock[]) => {
  const loaded = toEditor(blocks);
  return fromEditor(doc(loaded.blocks), loaded.images);
};

describe("body blocks in the editor", () => {
  it("comes back as it went in, for every kind of block", () => {
    const blocks: ContentBlock[] = [
      { type: "heading_1", text: [{ text: "One" }] },
      { type: "heading_2", text: [{ text: "Two" }] },
      { type: "heading_3", text: [{ text: "Three" }] },
      {
        type: "paragraph",
        text: [
          { text: "plain " },
          { text: "bold", bold: true, italic: true },
          { text: "\nline " },
          { text: "link", href: "https://example.com", code: true, strike: true },
        ],
      },
      { type: "paragraph", text: [] },
      {
        type: "bulleted_list_item",
        text: [{ text: "a" }],
        children: [
          { type: "to_do", text: [{ text: "b" }], checked: true },
          { type: "numbered_list_item", text: [{ text: "c" }] },
        ],
      },
      { type: "to_do", text: [{ text: "d" }], checked: false },
      { type: "quote", text: [{ text: "q" }] },
      { type: "code", language: "c++", text: "int main() {\n}" },
      { type: "code", language: "plain text", text: "" },
      { type: "divider" },
      { type: "image", url: "https://example.com/a.png", caption: [{ text: "A", bold: true }] },
      { type: "notion_image", id: "n1", url: "https://files.example/signed", caption: [] },
    ];
    expect(roundTrip(blocks)).toEqual({
      blocks: blocks.map((b) => (b.type === "notion_image" ? { type: b.type, id: b.id, caption: b.caption } : b)),
    });
  });

  it("keeps a Notion image only with its own picture", () => {
    const loaded = toEditor([{ type: "notion_image", id: "n1", url: "https://files.example/signed", caption: [] }]);
    const [image] = doc(loaded.blocks);
    if (!image) throw new Error("no image");
    const as = (id: string, url: string, caption = "") => ({ ...image, id, props: { url, caption } });
    // A new caption is plain text; a new address makes it an external image.
    expect(fromEditor([as(image.id, image.props.url as string, "new")], loaded.images)).toEqual({
      blocks: [{ type: "notion_image", id: "n1", caption: [{ text: "new" }] }],
    });
    expect(fromEditor([as(image.id, "https://example.com/b.png")], loaded.images)).toEqual({
      blocks: [{ type: "image", url: "https://example.com/b.png", caption: [] }],
    });
    // A copy has the signed address, which stops working within the hour.
    expect(
      fromEditor(
        [as(image.id, "https://files.example/signed"), as("copy", "https://files.example/signed")],
        loaded.images,
      ),
    ).toEqual({
      problem: "image_copy",
    });
    // An image without an address is left out.
    expect(fromEditor([as("new", "")], loaded.images)).toEqual({ blocks: [] });
  });

  it("refuses nesting the server does not take", () => {
    const item = (children: EditorBlockInit[] = []): EditorBlockInit => ({
      type: "bulletListItem",
      content: [{ type: "text", text: "x", styles: {} }],
      children,
    });
    const none = new Map();
    expect(fromEditor(doc([{ type: "paragraph", children: [item()] }]), none)).toEqual({ problem: "nesting" });
    expect(fromEditor(doc([item([{ type: "paragraph" }])]), none)).toEqual({ problem: "nesting" });
    expect(fromEditor(doc([item([item([item()])])]), none)).toEqual({ problem: "nesting" });
    expect(fromEditor(doc([{ type: "table" }]), none)).toEqual({ problem: "unsupported" });
    const link = (href: string): EditorBlockInit => ({
      type: "paragraph",
      content: [{ type: "link", href, content: [{ type: "text", text: "x", styles: {} }] }],
    });
    expect(fromEditor(doc([link("example.com")]), none)).toEqual({ problem: "link" });
    expect(
      fromEditor(doc([item([link("javascript:alert(1)")].map((l) => ({ ...l, type: "bulletListItem" })))]), none),
    ).toEqual({ problem: "link" });
    expect(fromEditor(doc([link("MAILTO:a@example.com")]), none)).toMatchObject({ blocks: [{ type: "paragraph" }] });
  });

  it("leaves out the empty paragraphs at the end, and the addresses of Notion images when comparing", () => {
    const loaded = toEditor([]);
    expect(
      fromEditor(
        doc([{ type: "paragraph" }, { type: "divider" }, { type: "paragraph" }, { type: "paragraph" }]),
        loaded.images,
      ),
    ).toEqual({ blocks: [{ type: "paragraph", text: [] }, { type: "divider" }] });
    expect(
      sameBlocks(
        [
          { type: "notion_image", id: "n", url: "https://a", caption: [] },
          { type: "paragraph", text: [] },
        ],
        [{ type: "notion_image", id: "n", caption: [] }],
      ),
    ).toBe(true);
  });
});
