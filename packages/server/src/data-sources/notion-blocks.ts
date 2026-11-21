import { NOTION_TEXT_SEGMENT } from "@bukitjalil/shared";
import { isRecord } from "../bukit/guard.ts";
import { SiteError } from "../sites/location.ts";
import { notionId } from "./service.ts";

/**
 * A page body as Markdown and back (plan 5.6 item 7). Only the supported blocks and inline styles convert;
 * anything else is reported so the body stays read-only, because saving replaces the whole body and would
 * drop it. The Markdown is BukitJalil's own small dialect:
 *
 * - blocks are separated by a blank line; list items follow each other line by line, and a list item's
 *   children are its following lines indented by spaces (one level only);
 * - `&nbsp;` alone on a line is an empty paragraph;
 * - inline: `**bold**`, `_italic_`, `~~strike~~`, `` `code` ``, `[text](url)`, `<br>` for a line break inside
 *   a block, and a backslash before any punctuation for the character itself;
 * - `![caption](url)` alone on a line is an external image; `notion-image:<block id>` as the URL is an image
 *   uploaded to Notion, kept as it is when saving.
 */

export const HOSTED_IMAGE = "notion-image:";
const LIST_TYPES = new Set(["bulleted_list_item", "numbered_list_item", "to_do"]);
const RICH_TEXT_MAX = 100;
const INDENT = "    ";

/** The code languages Notion accepts (API 2022-06-28); anything else would be refused half way through a save. */
const CODE_LANGUAGES = new Set([
  "abap",
  "agda",
  "arduino",
  "ascii art",
  "assembly",
  "bash",
  "basic",
  "bnf",
  "c",
  "c#",
  "c++",
  "clojure",
  "coffeescript",
  "coq",
  "css",
  "dart",
  "dhall",
  "diff",
  "docker",
  "ebnf",
  "elixir",
  "elm",
  "erlang",
  "f#",
  "flow",
  "fortran",
  "gherkin",
  "glsl",
  "go",
  "graphql",
  "groovy",
  "haskell",
  "hcl",
  "html",
  "idris",
  "java",
  "javascript",
  "json",
  "julia",
  "kotlin",
  "latex",
  "less",
  "lisp",
  "livescript",
  "llvm ir",
  "lua",
  "makefile",
  "markdown",
  "markup",
  "matlab",
  "mathematica",
  "mermaid",
  "nix",
  "notion formula",
  "objective-c",
  "ocaml",
  "pascal",
  "perl",
  "php",
  "plain text",
  "powershell",
  "prolog",
  "protobuf",
  "purescript",
  "python",
  "r",
  "racket",
  "reason",
  "ruby",
  "rust",
  "sass",
  "scala",
  "scheme",
  "scss",
  "shell",
  "smalltalk",
  "solidity",
  "sql",
  "swift",
  "toml",
  "typescript",
  "vb.net",
  "verilog",
  "vhdl",
  "visual basic",
  "webassembly",
  "xml",
  "yaml",
  "java/c/c++/c#",
]);
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

/** A block as Notion returned it, with its children read when it has any. */
export interface RawBlock {
  block: Record<string, unknown>;
  children?: RawBlock[];
}

/** What a save writes: a new block, or a Notion-hosted image kept in place (its caption may change). */
export type BodyItem =
  | { kind: "block"; block: Record<string, unknown> }
  | { kind: "keep"; id: string; caption: Record<string, unknown>[] };

export const isListType = (type: string) => LIST_TYPES.has(type);

const typeOf = (block: Record<string, unknown>) => (typeof block.type === "string" ? block.type : "unknown");
const dataOf = (block: Record<string, unknown>) => {
  const data = block[typeOf(block)];
  return isRecord(data) ? data : {};
};
const richOf = (data: Record<string, unknown>, key = "rich_text") => (Array.isArray(data[key]) ? data[key] : []);

export const isHostedImage = (block: Record<string, unknown>) =>
  typeOf(block) === "image" && dataOf(block).type === "file";

// ── Notion → Markdown ────────────────────────────────────────────────────────

/** The body as Markdown, and what keeps it from being edited here (empty when nothing does). */
export function blocksToMarkdown(blocks: RawBlock[]): { markdown: string; unsupported: string[] } {
  const problems = new Set<string>();
  let markdown = "";
  blocks.forEach((raw, index) => {
    const list = isListType(typeOf(raw.block));
    // List items follow each other line by line; every other block needs a blank line before it.
    if (index > 0) markdown += list && isListType(typeOf(blocks[index - 1]?.block ?? {})) ? "\n" : "\n\n";
    markdown += blockMarkdown(raw, problems, 0);
  });
  return { markdown: problems.size > 0 ? "" : markdown, unsupported: [...problems].sort() };
}

function blockMarkdown(raw: RawBlock, problems: Set<string>, depth: number): string {
  const { block } = raw;
  const type = typeOf(block);
  const data = dataOf(block);
  const list = isListType(type);
  // Only a top-level list item may have children, and only list items: the dialect nests nothing else.
  if ((block.has_children === true && !(list && depth === 0)) || (depth > 0 && !list)) problems.add("children");
  if (typeof data.color === "string" && data.color !== "default") problems.add("color");
  const text = () => inlineMarkdown(richOf(data), problems);
  let out: string;
  switch (type) {
    case "paragraph": {
      const md = text();
      out = md === "" ? "&nbsp;" : leadEscape(md);
      break;
    }
    case "heading_1":
    case "heading_2":
    case "heading_3":
      if (data.is_toggleable === true) problems.add("toggle");
      out = `${"#".repeat(Number(type.slice(-1)))} ${text()}`;
      break;
    case "bulleted_list_item":
      out = `- ${text()}`;
      break;
    case "numbered_list_item":
      out = `1. ${text()}`;
      break;
    case "to_do":
      out = `- [${data.checked === true ? "x" : " "}] ${text()}`;
      break;
    case "quote":
      out = `> ${text()}`;
      break;
    case "code": {
      if (richOf(data, "caption").length > 0) problems.add("caption");
      const spans = spansOf(richOf(data), problems);
      if (spans.some((s) => s.format.bold || s.format.italic || s.format.strike || s.format.href))
        problems.add("code_format");
      const content = spans.map((s) => s.text).join("");
      const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      const language = typeof data.language === "string" && data.language !== "plain text" ? data.language : "";
      out = `${fence}${language}\n${content}\n${fence}`;
      break;
    }
    case "divider":
      out = "---";
      break;
    case "image": {
      let url: string;
      if (data.type === "file") url = `${HOSTED_IMAGE}${notionId(String(block.id ?? "")) ?? ""}`;
      else {
        const external = isRecord(data.external) ? data.external : {};
        url = typeof external.url === "string" ? external.url : "";
        if (!/^https?:\/\//i.test(url)) problems.add("image_url");
      }
      out = `![${inlineMarkdown(richOf(data, "caption"), problems)}](${escapeUrl(url)})`;
      break;
    }
    default:
      problems.add(type);
      return "";
  }
  for (const child of raw.children ?? []) out += `\n${INDENT}${blockMarkdown(child, problems, depth + 1)}`;
  return out;
}

/** Notion rich text as spans, noting what the dialect cannot hold. */
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

function inlineMarkdown(rich: unknown[], problems: Set<string>): string {
  // Neighbouring spans with the same link make one link, with their styles inside.
  const groups: Span[][] = [];
  for (const span of spansOf(rich, problems)) {
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

// ── Markdown → Notion ────────────────────────────────────────────────────────

const FENCE = /^(`{3,})(.*)$/;
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

const invalid = () => new SiteError("content.body_invalid", 400);

/** The Markdown as the blocks to write. Throws `content.body_invalid` for what Notion would not take. */
export function markdownToItems(markdown: string): BodyItem[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const items: BodyItem[] = [];
  /** The top-level list item that indented list lines go under. */
  let parent: Record<string, unknown> | null = null;
  const push = (block: Record<string, unknown>) => items.push({ kind: "block", block });
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
      push(
        block("code", {
          rich_text: richText([{ text: body.join("\n"), format: PLAIN }]),
          language: codeLanguage(fence[2] ?? ""),
        }),
      );
      parent = null;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      push(block(`heading_${heading[1]?.length}`, { rich_text: richText(parseInline(heading[2] ?? "")) }));
      parent = null;
      i++;
      continue;
    }
    if (DIVIDER.test(line)) {
      push(block("divider", {}));
      parent = null;
      i++;
      continue;
    }
    if (isImageLine(line)) {
      items.push(imageItem(line.trimEnd()));
      parent = null;
      i++;
      continue;
    }
    const list = LIST.exec(line);
    if (list) {
      const marker = list[2] ?? "-";
      let content = list[3] ?? "";
      let type = /\d/.test(marker) ? "numbered_list_item" : "bulleted_list_item";
      const data: Record<string, unknown> = {};
      const todo = type === "bulleted_list_item" ? TODO.exec(content) : null;
      if (todo) {
        type = "to_do";
        data.checked = todo[1] !== " ";
        content = todo[2] ?? "";
      }
      data.rich_text = richText(parseInline(content));
      const item = block(type, data);
      if ((list[1]?.length ?? 0) > 0 && parent) {
        const parentData = parent[parent.type as string] as Record<string, unknown>;
        if (!Array.isArray(parentData.children)) parentData.children = [];
        const children = parentData.children as Record<string, unknown>[];
        if (children.length >= 100) throw invalid();
        children.push(item);
      } else {
        push(item);
        parent = item;
      }
      i++;
      continue;
    }
    parent = null;
    if (QUOTE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) quote.push(QUOTE.exec(lines[i++] ?? "")?.[1] ?? "");
      push(block("quote", { rich_text: richText(parseInline(quote.join("\n"))) }));
      continue;
    }
    if (line.trim() === "&nbsp;") {
      push(block("paragraph", { rich_text: [] }));
      i++;
      continue;
    }
    const paragraph: string[] = [line];
    i++;
    while (i < lines.length && (lines[i] ?? "").trim() !== "" && !startsBlock(lines[i] ?? ""))
      paragraph.push(lines[i++] ?? "");
    push(block("paragraph", { rich_text: richText(parseInline(paragraph.join("\n"))) }));
  }
  return items;
}

function block(type: string, data: Record<string, unknown>): Record<string, unknown> {
  return { object: "block", type, [type]: data };
}

function imageItem(line: string): BodyItem {
  // The URL escapes `(` and `)`, so the last unescaped `(` starts it; the caption may hold links of its own.
  let j = line.length - 2;
  while (j > 2 && !(line[j] === "(" && line[j - 1] === "]" && !escaped(line, j - 1) && !escaped(line, j))) j--;
  if (j <= 2) throw invalid();
  const caption = richText(parseInline(line.slice(2, j - 1)));
  const url = unescapeUrl(line.slice(j + 1, -1));
  if (url.startsWith(HOSTED_IMAGE)) {
    const id = notionId(url.slice(HOSTED_IMAGE.length));
    if (!id) throw invalid();
    return { kind: "keep", id, caption };
  }
  if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) throw invalid();
  return { kind: "block", block: block("image", { type: "external", external: { url }, caption }) };
}

/** Whether the character at `at` follows an odd number of backslashes. */
function escaped(text: string, at: number): boolean {
  let n = 0;
  for (let k = at - 1; k >= 0 && text[k] === "\\"; k--) n++;
  return n % 2 === 1;
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
    if (c === "\\" && /[!-/:-@[-`{-~]/.test(source[i + 1] ?? "")) {
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

function linkAt(source: string, at: number): { text: string; url: string; end: number } | null {
  let j = at + 1;
  while (j < source.length && source[j] !== "]") {
    if (source[j] === "\\") j += 2;
    else if (source[j] === "`") {
      // A code span inside the label may hold `]`; it ends where its closing run is, as parseInline reads it.
      const run = /^`+/.exec(source.slice(j))?.[0].length ?? 1;
      const end = closingRun(source, j + run, run);
      j = end < 0 ? j + run : end + run;
    } else j++;
  }
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
 * The items as Notion would return them once written, so the saved body can be shown as Markdown without
 * reading it again.
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
  return inlineMarkdown(richOf(dataOf(old), "caption"), new Set()) !== inlineMarkdown(stored(caption), new Set());
}
