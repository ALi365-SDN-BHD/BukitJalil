import type { ContentBlock, ContentListItem, ContentSpan } from "@bukitjalil/shared";

/**
 * Converting a page body between the blocks the server reads and writes (`ContentBlock`, plan 5.6 item 7) and
 * the block editor's document. Only the kinds the editor's schema has are converted; anything else, or nesting
 * the server does not take, is reported instead of being dropped.
 */

type Styles = Partial<Record<"bold" | "italic" | "strike" | "code", boolean>>;
interface EditorText {
  type: "text";
  text: string;
  styles: Styles;
}
interface EditorLink {
  type: "link";
  href: string;
  content: EditorText[];
}
type EditorInline = EditorText | EditorLink;

/** A block of the editor's document, as far as this reads it. */
export interface EditorBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children: EditorBlock[];
}
/** A block to load into the editor. */
export interface EditorBlockInit {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: EditorInline[];
  children?: EditorBlockInit[];
}

/** An image as it was loaded, by its editor block id: whether it is in Notion, and its caption with styles. */
export interface LoadedImage {
  notionId?: string;
  url: string;
  caption: ContentSpan[];
}
export type LoadedImages = ReadonlyMap<string, LoadedImage>;

/** Why the editor's document cannot be saved as it is. */
export type BlocksProblem = "nesting" | "image_copy" | "link" | "unsupported";

const STYLES = ["bold", "italic", "strike", "code"] as const;

function toInline(spans: readonly ContentSpan[]): EditorInline[] {
  return spans.map((s) => {
    const styles: Styles = {};
    for (const key of STYLES) if (s[key]) styles[key] = true;
    const text: EditorText = { type: "text", text: s.text, styles };
    return s.href ? { type: "link", href: s.href, content: [text] } : text;
  });
}

function fromText(t: EditorText, href?: string): ContentSpan[] {
  if (!t.text) return [];
  const span: ContentSpan = { text: t.text };
  for (const key of STYLES) if (t.styles?.[key] === true) span[key] = true;
  if (href) span.href = href;
  return [span];
}

function fromInline(content: unknown): ContentSpan[] {
  if (!Array.isArray(content)) return [];
  return (content as EditorInline[]).flatMap((c) =>
    c.type === "link" ? c.content.flatMap((t) => fromText(t, c.href)) : c.type === "text" ? fromText(c) : [],
  );
}

const plain = (content: unknown) =>
  Array.isArray(content)
    ? (content as EditorInline[])
        .map((c) => (c.type === "text" ? c.text : c.content.map((t) => t.text).join("")))
        .join("")
    : "";

const LIST: Record<ContentListItem["type"], string> = {
  bulleted_list_item: "bulletListItem",
  numbered_list_item: "numberedListItem",
  to_do: "checkListItem",
};

function listToEditor(b: ContentListItem): EditorBlockInit {
  return {
    type: LIST[b.type],
    ...(b.type === "to_do" ? { props: { checked: b.checked } } : {}),
    content: toInline(b.text),
    children: (b.children ?? []).map(listToEditor),
  };
}

/** The server's blocks as the editor's document, and the images it loaded, to tell kept ones from new ones. */
export function toEditor(blocks: readonly ContentBlock[]): { blocks: EditorBlockInit[]; images: LoadedImages } {
  const images = new Map<string, LoadedImage>();
  const out = blocks.map((b, i): EditorBlockInit => {
    switch (b.type) {
      case "paragraph":
        return { type: "paragraph", content: toInline(b.text) };
      case "heading_1":
      case "heading_2":
      case "heading_3":
        return { type: "heading", props: { level: Number(b.type.slice(-1)) }, content: toInline(b.text) };
      case "quote":
        return { type: "quote", content: toInline(b.text) };
      case "code":
        return {
          type: "codeBlock",
          props: { language: b.language },
          content: b.text ? [{ type: "text", text: b.text, styles: {} }] : [],
        };
      case "divider":
        return { type: "divider" };
      case "image":
      case "notion_image": {
        const url = b.type === "image" ? b.url : (b.url ?? "");
        const id = `image-${i}`;
        images.set(id, { ...(b.type === "notion_image" ? { notionId: b.id } : {}), url, caption: b.caption });
        return { id, type: "image", props: { url, caption: b.caption.map((s) => s.text).join("") } };
      }
      default:
        return listToEditor(b);
    }
  });
  return { blocks: out, images };
}

const LIST_TYPES: Record<string, ContentListItem["type"]> = {
  bulletListItem: "bulleted_list_item",
  numberedListItem: "numbered_list_item",
  checkListItem: "to_do",
};

function listFromEditor(b: EditorBlock, type: ContentListItem["type"]) {
  const text = fromInline(b.content);
  return type === "to_do"
    ? { type, text, checked: b.props.checked === true }
    : { type: type as Exclude<typeof type, "to_do">, text };
}

/**
 * The editor's document as the server's blocks, or why it cannot be saved: only a top-level list item has
 * children, and only list items without their own. An image without an address is left out, and an image
 * kept from Notion with its picture unchanged stays a Notion image (one with a new address is an external one).
 */
export function fromEditor(
  doc: readonly EditorBlock[],
  images: LoadedImages,
): { blocks: ContentBlock[] } | { problem: BlocksProblem } {
  const blocks: ContentBlock[] = [];
  const hosted = new Set([...images.values()].flatMap((i) => (i.notionId && i.url ? [i.url] : [])));
  for (const b of doc) {
    const listType = LIST_TYPES[b.type];
    if (listType) {
      const children = [];
      for (const c of b.children) {
        const childType = LIST_TYPES[c.type];
        if (!childType || c.children.length > 0) return { problem: "nesting" };
        children.push(listFromEditor(c, childType));
      }
      blocks.push({ ...listFromEditor(b, listType), ...(children.length > 0 ? { children } : {}) } as ContentBlock);
      continue;
    }
    if (b.children.length > 0) return { problem: "nesting" };
    switch (b.type) {
      case "paragraph":
        blocks.push({ type: "paragraph", text: fromInline(b.content) });
        break;
      case "heading": {
        const level = b.props.level === 2 || b.props.level === 3 ? b.props.level : 1;
        blocks.push({ type: `heading_${level}`, text: fromInline(b.content) });
        break;
      }
      case "quote":
        blocks.push({ type: "quote", text: fromInline(b.content) });
        break;
      case "codeBlock":
        blocks.push({ type: "code", language: String(b.props.language ?? ""), text: plain(b.content) });
        break;
      case "divider":
        blocks.push({ type: "divider" });
        break;
      case "image": {
        const url = String(b.props.url ?? "");
        const captionText = String(b.props.caption ?? "");
        const loaded = images.get(b.id);
        const caption =
          loaded && loaded.caption.map((s) => s.text).join("") === captionText
            ? loaded.caption
            : captionText
              ? [{ text: captionText }]
              : [];
        if (loaded?.notionId && url === loaded.url) blocks.push({ type: "notion_image", id: loaded.notionId, caption });
        // A copy of an image in Notion: its address is signed for an hour, so it cannot be kept as a new image.
        else if (hosted.has(url)) return { problem: "image_copy" };
        else if (url) blocks.push({ type: "image", url, caption });
        break;
      }
      default:
        return { problem: "unsupported" };
    }
  }
  return blocks.some(hasBadLink) ? { problem: "link" } : { blocks: normalize(blocks) };
}

/** Links Notion takes: web and mail addresses (as `ContentSpan` checks them). */
const LINK = /^(https?:\/\/|mailto:)/i;
const badSpans = (spans: readonly ContentSpan[]) => spans.some((s) => s.href !== undefined && !LINK.test(s.href));

function hasBadLink(b: ContentBlock): boolean {
  if ("caption" in b) return badSpans(b.caption);
  if (!("text" in b) || typeof b.text === "string") return false;
  return badSpans(b.text) || ("children" in b && (b.children ?? []).some(hasBadLink));
}

const emptyParagraph = (b: ContentBlock | undefined) => b?.type === "paragraph" && b.text.length === 0;

/** Without the empty paragraphs at the end, which the editor always keeps one of. */
export function normalize(blocks: readonly ContentBlock[]): ContentBlock[] {
  let end = blocks.length;
  while (end > 0 && emptyParagraph(blocks[end - 1])) end--;
  return blocks.slice(0, end);
}

/** Whether two bodies say the same, leaving out the addresses images in Notion are shown with. */
export function sameBlocks(a: readonly ContentBlock[], b: readonly ContentBlock[]): boolean {
  const key = (blocks: readonly ContentBlock[]) =>
    JSON.stringify(normalize(blocks).map((x) => (x.type === "notion_image" ? { ...x, url: undefined } : x)));
  return key(a) === key(b);
}
