import { CONTENT_CODE_LANGUAGES, type ContentBlock, type ContentSpan, NOTION_TEXT_SEGMENT } from "@bukitjalil/shared";
import { isRecord } from "../bukit/guard.ts";
import { SiteError } from "../sites/location.ts";
import { notionId } from "./service.ts";

/**
 * A page body as blocks and back (plan 5.6 item 7). Only the supported blocks and inline styles convert;
 * anything else is reported so the body stays read-only, because saving replaces the whole body and would
 * drop it. The editor works on `ContentBlock`s; the same blocks also read and write BukitJalil's own small
 * Markdown dialect, kept for the AI (plan: docs/plans/2026-11-22-content-editor-and-ai-design.md):
 *
 * - blocks are separated by a blank line; list items follow each other line by line, and a list item's
 *   children are its following lines indented by spaces (one level only);
 * - `&nbsp;` alone on a line is an empty paragraph;
 * - inline: `**bold**`, `_italic_`, `~~strike~~`, `` `code` ``, `[text](url)`, `<br>` for a line break inside
 *   a block, and a backslash before any punctuation or white space for the character itself;
 * - `![caption](url)` alone on a line is an external image; `notion-image:<block id>` as the URL is an image
 *   uploaded to Notion, kept as it is when saving.
 */

export const HOSTED_IMAGE = "notion-image:";
const LIST_TYPES = new Set(["bulleted_list_item", "numbered_list_item", "to_do"]);
const RICH_TEXT_MAX = 100;
/**
 * Notion refuses requests over about 500 KB; a save's batches stay well under it. A block is never split
 * (its children go in the same request), so one block bigger than this cannot be written at all.
 */
export const BATCH_BYTES = 300_000;
const INDENT = "    ";

/** The code languages Notion accepts; anything else would be refused half way through a save. */
export const CODE_LANGUAGES: ReadonlySet<string> = new Set(CONTENT_CODE_LANGUAGES);
/** Common fence names for Notion's languages. */
const CODE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  sh: "shell",
  zsh: "shell",
  yml: "yaml",
  md: "markdown",
  text: "plain text",
  txt: "plain text",
  plaintext: "plain text",
  dockerfile: "docker",
  objc: "objective-c",
  cs: "c#",
  csharp: "c#",
  cpp: "c++",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
};

function codeLanguage(info: string): string {
  const name = info.trim().toLowerCase();
  if (!name) return "plain text";
  const language = CODE_ALIASES[name] ?? name;
  if (!CODE_LANGUAGES.has(language)) throw invalid();
  return language;
}

interface Format {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  href: string | null;
}
interface Span {
  text: string;
  format: Format;
}
const PLAIN: Format = { bold: false, italic: false, strike: false, code: false, href: null };

const toContent = ({ text, format }: Span): ContentSpan => ({
  text,
  ...(format.bold ? { bold: true } : {}),
  ...(format.italic ? { italic: true } : {}),
  ...(format.strike ? { strike: true } : {}),
  ...(format.code ? { code: true } : {}),
  ...(format.href ? { href: format.href } : {}),
});
const fromContent = (span: ContentSpan): Span => ({
  text: span.text,
  format: {
    bold: span.bold === true,
    italic: span.italic === true,
    strike: span.strike === true,
    code: span.code === true,
    href: span.href ?? null,
  },
});

/** A block as Notion returned it, with its children read when it has any. */
export interface RawBlock {
  block: Record<string, unknown>;
  children?: RawBlock[];
}

/** What a save writes: a new block, or a Notion-hosted image kept in place (its caption may change). */
export type BodyItem =
  | { kind: "block"; block: Record<string, unknown> }
  | { kind: "keep"; id: string; caption: Record<string, unknown>[] };

type ListItem = Extract<ContentBlock, { type: "bulleted_list_item" | "numbered_list_item" | "to_do" }>;
type ListLeaf = NonNullable<ListItem["children"]>[number];

export const isListType = (type: string) => LIST_TYPES.has(type);
const isListBlock = (b: ContentBlock): b is ListItem => isListType(b.type);

const typeOf = (block: Record<string, unknown>) => (typeof block.type === "string" ? block.type : "unknown");
const dataOf = (block: Record<string, unknown>) => {
  const data = block[typeOf(block)];
  return isRecord(data) ? data : {};
};
const richOf = (data: Record<string, unknown>, key = "rich_text") => (Array.isArray(data[key]) ? data[key] : []);

export const isHostedImage = (block: Record<string, unknown>) =>
  typeOf(block) === "image" && dataOf(block).type === "file";

const invalid = () => new SiteError("content.body_invalid", 400);

// ── Notion → blocks ─────────────────────────────────────────────────────────

/**
 * The body as blocks, and what keeps it from being edited here (when anything does, the blocks are empty).
 * Whatever reads fine but could not be written back would make every save fail, so it is read-only too.
 */
export function readBody(raw: RawBlock[]): { blocks: ContentBlock[]; unsupported: string[] } {
  const problems = new Set<string>();
  const blocks = raw.flatMap((b) => contentOf(b, problems, 0));
  if (problems.size === 0) {
    try {
      contentToItems(blocks);
    } catch (err) {
      if (!(err instanceof SiteError)) throw err;
      problems.add("unwritable");
    }
  }
  return problems.size > 0 ? { blocks: [], unsupported: [...problems].sort() } : { blocks, unsupported: [] };
}

function contentOf(raw: RawBlock, problems: Set<string>, depth: number): ContentBlock[] {
  const { block } = raw;
  const type = typeOf(block);
  const data = dataOf(block);
  const list = isListType(type);
  // Only a top-level list item may have children, and only list items: nothing else nests here.
  if ((block.has_children === true && !(list && depth === 0)) || (depth > 0 && !list)) problems.add("children");
  // A save writes a block's children in one request, which Notion caps at 100.
  if ((raw.children?.length ?? 0) > 100) problems.add("children");
  if (typeof data.color === "string" && data.color !== "default") problems.add("color");
  const text = () => spansOf(richOf(data), problems).map(toContent);
  switch (type) {
    case "paragraph":
    case "quote":
      return [{ type, text: text() }];
    case "heading_1":
    case "heading_2":
    case "heading_3":
      if (data.is_toggleable === true) problems.add("toggle");
      return [{ type, text: text() }];
    case "bulleted_list_item":
    case "numbered_list_item":
    case "to_do": {
      // A nested block that is not a list item was reported above; the body is read-only then.
      const children = (raw.children ?? [])
        .flatMap((child) => contentOf(child, problems, depth + 1))
        .filter(isListBlock)
        .map(({ children: _, ...leaf }) => leaf as ListLeaf);
      const more = children.length > 0 ? { children } : {};
      return [
        type === "to_do"
          ? { type, text: text(), checked: data.checked === true, ...more }
          : { type, text: text(), ...more },
      ];
    }
    case "code": {
      if (richOf(data, "caption").length > 0) problems.add("caption");
      const spans = spansOf(richOf(data), problems);
      if (spans.some((s) => s.format.bold || s.format.italic || s.format.strike || s.format.href))
        problems.add("code_format");
      const language = typeof data.language === "string" && data.language ? data.language : "plain text";
      // A language this cannot write back would make every save fail.
      if (!CODE_LANGUAGES.has(language)) problems.add("code_language");
      return [{ type, language, text: spans.map((s) => s.text).join("") }];
    }
    case "divider":
      return [{ type }];
    case "image": {
      const caption = spansOf(richOf(data, "caption"), problems).map(toContent);
      if (data.type === "file") {
        const file = isRecord(data.file) ? data.file : {};
        const shown = typeof file.url === "string" ? { url: file.url } : {};
        return [{ type: "notion_image", id: notionId(String(block.id ?? "")) ?? "", ...shown, caption }];
      }
      const external = isRecord(data.external) ? data.external : {};
      const url = typeof external.url === "string" ? external.url : "";
      if (!/^https?:\/\//i.test(url)) problems.add("image_url");
      return [{ type, url, caption }];
    }
    default:
      problems.add(type);
      return [];
  }
}

/** Notion rich text as spans, noting what cannot be held here. */
function spansOf(rich: unknown[], problems: Set<string>): Span[] {
  const spans: Span[] = [];
  for (const part of rich) {
    if (!isRecord(part)) continue;
    if (part.type !== "text") {
      problems.add(typeof part.type === "string" ? part.type : "unknown");
      continue;
    }
    const a = isRecord(part.annotations) ? part.annotations : {};
    if (a.underline === true) problems.add("underline");
    if (typeof a.color === "string" && a.color !== "default") problems.add("color");
    const text = isRecord(part.text) ? part.text : {};
    const link = isRecord(text.link) ? text.link : null;
    const href = typeof part.href === "string" ? part.href : link && typeof link.url === "string" ? link.url : null;
    if (href !== null && !safeHref(href)) problems.add("link");
    const content =
      typeof text.content === "string" ? text.content : typeof part.plain_text === "string" ? part.plain_text : "";
    spans.push({
      text: content,
      format: {
        bold: a.bold === true,
        italic: a.italic === true,
        strike: a.strikethrough === true,
        code: a.code === true,
        href,
      },
    });
  }
  return merge(spans);
}

const safeHref = (href: string) => /^(https?:\/\/|mailto:)/i.test(href);

function sameFormat(a: Format, b: Format): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.code === b.code && a.href === b.href;
}

function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    if (!span.text) continue;
    const last = out.at(-1);
    if (last && sameFormat(last.format, span.format)) last.text += span.text;
    else out.push({ text: span.text, format: { ...span.format } });
  }
  return out;
}

// ── blocks → Notion ─────────────────────────────────────────────────────────

/** The blocks to write. Throws `content.body_invalid` for what Notion would not take. */
export function contentToItems(blocks: readonly ContentBlock[]): BodyItem[] {
  const items = blocks.map((b): BodyItem => {
    if (b.type !== "notion_image") return { kind: "block", block: notionBlock(b) };
    const id = notionId(b.id);
    if (!id) throw invalid();
    return { kind: "keep", id, caption: richText(b.caption.map(fromContent)) };
  });
  // Refused before anything is written, and so a body holding such a block reads as read-only.
  for (const item of items) {
    if (item.kind === "block" && Buffer.byteLength(JSON.stringify(item.block)) > BATCH_BYTES) throw invalid();
  }
  return items;
}

function notionBlock(b: Exclude<ContentBlock, { type: "notion_image" }> | ListLeaf): Record<string, unknown> {
  const rich = (spans: readonly ContentSpan[]) => richText(spans.map(fromContent));
  switch (b.type) {
    case "paragraph":
    case "heading_1":
    case "heading_2":
    case "heading_3":
    case "quote":
      return block(b.type, { rich_text: rich(b.text) });
    case "bulleted_list_item":
    case "numbered_list_item":
    case "to_do": {
      const data: Record<string, unknown> = { rich_text: rich(b.text) };
      if (b.type === "to_do") data.checked = b.checked;
      const children = "children" in b ? (b.children ?? []) : [];
      if (children.length > 100) throw invalid();
      if (children.length > 0) data.children = children.map(notionBlock);
      return block(b.type, data);
    }
    case "code":
      if (!CODE_LANGUAGES.has(b.language)) throw invalid();
      return block("code", { rich_text: richText([{ text: b.text, format: PLAIN }]), language: b.language });
    case "divider":
      return block("divider", {});
    case "image":
      if (!/^https?:\/\/\S+$/i.test(b.url) || b.url.length > 2000) throw invalid();
      return block("image", { type: "external", external: { url: b.url }, caption: rich(b.caption) });
  }
}

function block(type: string, data: Record<string, unknown>): Record<string, unknown> {
  return { object: "block", type, [type]: data };
}

/** Spans as Notion rich text: long text split at 2000 characters, at most 100 items per block. */
function richText(spans: Span[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (const { text, format } of spans) {
    for (const content of chunks(text)) {
      items.push({
        type: "text",
        text: { content, link: format.href ? { url: format.href } : null },
        annotations: {
          bold: format.bold,
          italic: format.italic,
          strikethrough: format.strike,
          underline: false,
          code: format.code,
          color: "default",
        },
      });
    }
  }
  if (items.length > RICH_TEXT_MAX) throw invalid();
  return items;
}

/** Text in pieces of at most 2000 characters, never splitting a surrogate pair. */
export function chunks(text: string): string[] {
  const parts: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(at + NOTION_TEXT_SEGMENT, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(text.slice(at, end));
    at = end;
  }
  return parts;
}

/**
 * The items as Notion would return them once written, so the saved body can be shown without reading it
 * again. A kept image's signed address is not known here; the caller adds it back.
 */
export function storedOf(items: BodyItem[]): RawBlock[] {
  return items.map((item) =>
    item.kind === "keep"
      ? { block: { id: item.id, type: "image", image: { type: "file", caption: stored(item.caption) } } }
      : storedBlock(item.block),
  );
}

function storedBlock(payload: Record<string, unknown>): RawBlock {
  const type = typeOf(payload);
  const { children, ...data } = dataOf(payload) as Record<string, unknown> & { children?: Record<string, unknown>[] };
  for (const key of ["rich_text", "caption"]) if (Array.isArray(data[key])) data[key] = stored(data[key] as unknown[]);
  return {
    block: { type, has_children: (children?.length ?? 0) > 0, [type]: data },
    ...(children?.length ? { children: children.map(storedBlock) } : {}),
  };
}

function stored(rich: unknown[]): Record<string, unknown>[] {
  return rich.filter(isRecord).map((part) => {
    const text = isRecord(part.text) ? part.text : {};
    const link = isRecord(text.link) ? text.link : null;
    return { ...part, plain_text: text.content, href: link?.url ?? null };
  });
}

/** Whether a kept image's new caption differs from the one it has. */
export function captionChanged(old: Record<string, unknown>, caption: Record<string, unknown>[]): boolean {
  const read = (rich: unknown[]) => JSON.stringify(spansOf(rich, new Set()));
  return read(richOf(dataOf(old), "caption")) !== read(stored(caption));
}

// ── blocks ↔ Markdown (the dialect at the top of this file) ─────────────────

/** The body as Markdown, and what keeps it from being edited (the Markdown is then empty). */
export function blocksToMarkdown(raw: RawBlock[]): { markdown: string; unsupported: string[] } {
  const problems = new Set<string>();
  const blocks = raw.flatMap((b) => contentOf(b, problems, 0));
  let markdown = "";
  if (problems.size === 0) {
    markdown = contentToMarkdown(blocks);
    // What reads fine but cannot be written back as Markdown (say, one code span of many lines, which becomes
    // more rich text items than Notion takes in a block) is read-only too.
    try {
      markdownToItems(markdown);
    } catch (err) {
      if (!(err instanceof SiteError)) throw err;
      problems.add("unwritable");
    }
  }
  return { markdown: problems.size > 0 ? "" : markdown, unsupported: [...problems].sort() };
}

export function contentToMarkdown(blocks: readonly ContentBlock[]): string {
  let markdown = "";
  blocks.forEach((b, index) => {
    // List items follow each other line by line; every other block needs a blank line before it.
    if (index > 0) markdown += isListType(b.type) && isListType(blocks[index - 1]?.type ?? "") ? "\n" : "\n\n";
    markdown += blockMarkdown(b);
  });
  return markdown;
}

function blockMarkdown(b: ContentBlock | ListLeaf): string {
  switch (b.type) {
    case "paragraph": {
      const md = inlineMarkdown(b.text);
      return md === "" ? "&nbsp;" : leadEscape(md);
    }
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return `${"#".repeat(Number(b.type.slice(-1)))} ${inlineMarkdown(b.text)}`;
    case "quote":
      return `> ${inlineMarkdown(b.text)}`;
    case "bulleted_list_item":
    case "numbered_list_item":
    case "to_do": {
      const marker = b.type === "to_do" ? `- [${b.checked ? "x" : " "}]` : b.type === "numbered_list_item" ? "1." : "-";
      let out = `${marker} ${inlineMarkdown(b.text)}`;
      for (const child of "children" in b ? (b.children ?? []) : []) out += `\n${INDENT}${blockMarkdown(child)}`;
      return out;
    }
    case "code": {
      const longest = Math.max(0, ...(b.text.match(/`+/g) ?? []).map((run) => run.length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      return `${fence}${b.language === "plain text" ? "" : b.language}\n${b.text}\n${fence}`;
    }
    case "divider":
      return "---";
    case "image":
      return `![${inlineMarkdown(b.caption)}](${escapeUrl(b.url)})`;
    case "notion_image":
      return `![${inlineMarkdown(b.caption)}](${HOSTED_IMAGE}${b.id})`;
  }
}

function inlineMarkdown(content: readonly ContentSpan[]): string {
  // Neighbouring spans with the same link make one link, with their styles inside.
  const groups: Span[][] = [];
  for (const span of content.map(fromContent)) {
    const last = groups.at(-1);
    if (last && last[0]?.format.href === span.format.href) last.push(span);
    else groups.push([span]);
  }
  return groups
    .map((group) => {
      const md = group.map(styled).join("");
      const href = group[0]?.format.href;
      return href ? `[${md}](${escapeUrl(href)})` : md;
    })
    .join("");
}

function styled({ text, format }: Span): string {
  let md = format.code
    ? text
        .split("\n")
        .map((line) => (line ? codeSpan(line) : ""))
        .join("<br>")
    : escapeInline(text);
  if (format.italic) md = `_${md}_`;
  if (format.bold) md = `**${md}**`;
  if (format.strike) md = `~~${md}~~`;
  return md;
}

function escapeInline(text: string): string {
  return text
    .replace(/[\\*_~`[\]]/g, "\\$&")
    .replace(/<br>/g, "\\<br>")
    .replace(/\n/g, "<br>");
}

/** A paragraph that would read as another block gets its first marker escaped. */
function leadEscape(md: string): string {
  if (md.trim() === "&nbsp;") return md.replace("&nbsp;", "\\&nbsp;");
  // A paragraph of only white space would read as a blank line: a backslash before it keeps it.
  if (md.trim() === "") return `\\${md}`;
  // `!` and then a link would read as an image.
  if (md.startsWith("![")) return `\\${md}`;
  return md.replace(
    /^(\s*)(#|-|\+|>|(\d+)([.)]))/,
    (_m, space: string, marker: string, digits?: string, dot?: string) =>
      digits ? `${space}${digits}\\${dot}` : `${space}\\${marker}`,
  );
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  // Padding is stripped again only around text that is not all spaces, so all-space code gets none.
  const pad = text.trim() && /^[` ]|[` ]$/.test(text) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function escapeUrl(url: string): string {
  return url.replace(/[\\()]/g, "\\$&").replace(/\s/g, (c) => encodeURIComponent(c));
}

// As in CommonMark, a fence's info string has no backticks: a line that opens with a long code span is not one.
const FENCE = /^(`{3,})([^`]*)$/;
const HEADING = /^(#{1,3})(?: (.*))?$/;
const DIVIDER = /^---\s*$/;
const LIST = /^(\s*)([-*+]|\d+[.)])(?: (.*))?$/;
const TODO = /^\[( |x|X)\](?: (.*))?$/;
const QUOTE = /^> ?(.*)$/;

const isImageLine = (line: string) => line.startsWith("![") && line.trimEnd().endsWith(")");
const startsBlock = (line: string) =>
  FENCE.test(line) ||
  HEADING.test(line) ||
  DIVIDER.test(line) ||
  LIST.test(line) ||
  QUOTE.test(line) ||
  isImageLine(line) ||
  line.trim() === "&nbsp;";

/** The Markdown as the blocks to write. Throws `content.body_invalid` for what Notion would not take. */
export function markdownToItems(markdown: string): BodyItem[] {
  return contentToItems(markdownToContent(markdown));
}

/** The Markdown as blocks. Throws `content.body_invalid` for what the dialect cannot mean. */
export function markdownToContent(markdown: string): ContentBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ContentBlock[] = [];
  /** The top-level list item that indented list lines go under, and how far its first child is indented. */
  let parent: ListItem | null = null;
  let childIndent = 0;
  const text = (source: string) => parseInline(source).map(toContent);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const close = new RegExp(`^\`{${fence[1]?.length},}\\s*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i] ?? "")) body.push(lines[i++] ?? "");
      i++;
      blocks.push({ type: "code", language: codeLanguage(fence[2] ?? ""), text: body.join("\n") });
      parent = null;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const type = `heading_${heading[1]?.length ?? 1}` as "heading_1" | "heading_2" | "heading_3";
      blocks.push({ type, text: text(heading[2] ?? "") });
      parent = null;
      i++;
      continue;
    }
    if (DIVIDER.test(line)) {
      blocks.push({ type: "divider" });
      parent = null;
      i++;
      continue;
    }
    if (isImageLine(line)) {
      blocks.push(imageBlock(line.trimEnd()));
      parent = null;
      i++;
      continue;
    }
    const list = LIST.exec(line);
    if (list) {
      const marker = list[2] ?? "-";
      const content = list[3] ?? "";
      const todo = /\d/.test(marker) ? null : TODO.exec(content);
      const item: ListItem = todo
        ? { type: "to_do", text: text(todo[2] ?? ""), checked: todo[1] !== " " }
        : { type: /\d/.test(marker) ? "numbered_list_item" : "bulleted_list_item", text: text(content) };
      const indent = list[1]?.length ?? 0;
      if (indent > 0 && parent) {
        // One level only: a line indented further than the first child would be a grandchild.
        if (childIndent === 0) childIndent = indent;
        else if (indent > childIndent) throw invalid();
        parent.children ??= [];
        parent.children.push(item as ListLeaf);
      } else {
        blocks.push(item);
        parent = item;
        childIndent = 0;
      }
      i++;
      continue;
    }
    parent = null;
    if (QUOTE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) quote.push(QUOTE.exec(lines[i++] ?? "")?.[1] ?? "");
      blocks.push({ type: "quote", text: text(quote.join("\n")) });
      continue;
    }
    if (line.trim() === "&nbsp;") {
      blocks.push({ type: "paragraph", text: [] });
      i++;
      continue;
    }
    const paragraph: string[] = [line];
    i++;
    while (i < lines.length && (lines[i] ?? "").trim() !== "" && !startsBlock(lines[i] ?? ""))
      paragraph.push(lines[i++] ?? "");
    blocks.push({ type: "paragraph", text: text(paragraph.join("\n")) });
  }
  return blocks;
}

function imageBlock(line: string): ContentBlock {
  // The caption ends at the first `](` outside its own links and code; the URL, whose parentheses are escaped,
  // is the rest of the line.
  const j = labelEnd(line, 2);
  if (line[j] !== "]" || line[j + 1] !== "(") throw invalid();
  const raw = line.slice(j + 2, -1);
  if (/(^|[^\\])(\\\\)*[()]/.test(raw)) throw invalid();
  const caption = parseInline(line.slice(2, j)).map(toContent);
  const url = unescapeUrl(raw);
  if (url.startsWith(HOSTED_IMAGE)) {
    const id = notionId(url.slice(HOSTED_IMAGE.length));
    if (!id) throw invalid();
    return { type: "notion_image", id, caption };
  }
  return { type: "image", url, caption };
}

function unescapeUrl(url: string): string {
  return url.replace(/\\(.)/g, "$1");
}

/** Inline Markdown as spans. A marker without its closing partner is plain text. */
export function parseInline(source: string, base: Format = PLAIN): Span[] {
  const spans: Span[] = [];
  const format = { ...base };
  let buffer = "";
  const flush = () => {
    if (buffer) spans.push({ text: buffer, format: { ...format } });
    buffer = "";
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i] ?? "";
    // A backslash before punctuation, or before white space (how a paragraph of spaces is written), is the
    // character itself.
    if (c === "\\" && /[!-/:-@[-`{-~]|\s/.test(source[i + 1] ?? "")) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }
    if (source.startsWith("<br>", i)) {
      buffer += "\n";
      i += 4;
      continue;
    }
    if (c === "`") {
      const run = /^`+/.exec(source.slice(i))?.[0] ?? "`";
      const end = closingRun(source, i + run.length, run.length);
      if (end < 0) {
        buffer += run;
        i += run.length;
        continue;
      }
      flush();
      let code = source.slice(i + run.length, end);
      if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
      spans.push({ text: code, format: { ...format, code: true } });
      i = end + run.length;
      continue;
    }
    const toggle = (["**", "~~", "_"] as const).find((m) => source.startsWith(m, i));
    if (toggle) {
      const key = toggle === "**" ? "bold" : toggle === "~~" ? "strike" : "italic";
      if (format[key] || hasClosing(source, i + toggle.length, toggle)) {
        flush();
        format[key] = !format[key];
        i += toggle.length;
        continue;
      }
    }
    if (c === "[" && format.href === null) {
      const link = linkAt(source, i);
      if (link) {
        flush();
        spans.push(...parseInline(link.text, { ...format, href: link.url }));
        i = link.end;
        continue;
      }
    }
    buffer += c;
    i++;
  }
  flush();
  return merge(spans);
}

function closingRun(source: string, from: number, length: number): number {
  for (let j = from; j < source.length; j++) {
    if (source[j] !== "`") continue;
    const run = /^`+/.exec(source.slice(j))?.[0].length ?? 0;
    if (run === length) return j;
    j += run - 1;
  }
  return -1;
}

function hasClosing(source: string, from: number, marker: string): boolean {
  for (let j = from; j < source.length; j++) {
    if (source[j] === "\\") j++;
    else if (source.startsWith(marker, j)) return true;
  }
  return false;
}

/**
 * Where a label starting at `from` ends: its first `]` that is not escaped or inside a code span (which may
 * hold `]`, read as parseInline reads it), nor, with `links`, inside a link of its own.
 */
function labelEnd(source: string, from: number, links = true): number {
  let j = from;
  while (j < source.length && source[j] !== "]") {
    if (source[j] === "\\") j += 2;
    else if (source[j] === "`") {
      const run = /^`+/.exec(source.slice(j))?.[0].length ?? 1;
      const end = closingRun(source, j + run, run);
      j = end < 0 ? j + run : end + run;
    } else if (links && source[j] === "[") j = linkAt(source, j)?.end ?? j + 1;
    else j++;
  }
  return j;
}

function linkAt(source: string, at: number): { text: string; url: string; end: number } | null {
  const j = labelEnd(source, at + 1, false);
  if (source[j] !== "]" || source[j + 1] !== "(") return null;
  let k = j + 2;
  let url = "";
  while (k < source.length && source[k] !== ")") {
    if (/\s/.test(source[k] ?? "")) return null;
    if (source[k] === "\\" && k + 1 < source.length) k++;
    url += source[k];
    k++;
  }
  if (source[k] !== ")" || !url || !safeHref(url) || url.length > 2000) return null;
  return { text: source.slice(at + 1, j), url, end: k + 1 };
}
