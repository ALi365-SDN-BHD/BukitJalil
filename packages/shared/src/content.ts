import { z } from "zod";

/**
 * Content management (plan 5.6): pages of a Notion database, read and written with a data source's token.
 * Only the property types below can be edited; every other type is shown read-only.
 */
export const EDITABLE_PROPERTY_TYPES = [
  "title",
  "rich_text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "checkbox",
  "url",
  "email",
  "phone_number",
] as const;
export type EditablePropertyType = (typeof EDITABLE_PROPERTY_TYPES)[number];

export const isEditablePropertyType = (type: string): type is EditablePropertyType =>
  (EDITABLE_PROPERTY_TYPES as readonly string[]).includes(type);

/** Notion's limit for one rich text segment; longer text is split into several (at most 100). */
export const NOTION_TEXT_SEGMENT = 2000;
/** What 100 segments always hold: a split moves back one unit rather than break a surrogate pair. */
export const CONTENT_TEXT_MAX = (NOTION_TEXT_SEGMENT - 1) * 100;
const NOTION_URL_MAX = 2000;
const NOTION_OPTION_MAX = 100;
/** One page of the entry list. */
export const CONTENT_PAGE_SIZE = 50;

const Text = z.string().max(CONTENT_TEXT_MAX);
const Short = z.string().max(NOTION_URL_MAX);
// Notion option names cannot contain commas.
const OptionName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((s) => !s.includes(","), "commas are not allowed");
// A date (2026-11-21) or a date and time with an offset (2026-11-21T09:30:00.000+08:00), as Notion returns them.
const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/)
  .refine((s) => !Number.isNaN(Date.parse(s)), "not a date");

/** A value of an editable property, as the form shows and sends it. */
export const ContentValue = z.discriminatedUnion("type", [
  z.object({ type: z.literal("title"), text: Text }).strict(),
  z.object({ type: z.literal("rich_text"), text: Text }).strict(),
  z.object({ type: z.literal("number"), number: z.number().finite().nullable() }).strict(),
  z.object({ type: z.literal("select"), option: OptionName.nullable() }).strict(),
  z.object({ type: z.literal("status"), option: OptionName.nullable() }).strict(),
  z.object({ type: z.literal("multi_select"), options: z.array(OptionName).max(NOTION_OPTION_MAX) }).strict(),
  z.object({ type: z.literal("date"), start: IsoDate.nullable(), end: IsoDate.nullable() }).strict(),
  z.object({ type: z.literal("checkbox"), checked: z.boolean() }).strict(),
  z.object({ type: z.literal("url"), text: Short.nullable() }).strict(),
  z.object({ type: z.literal("email"), text: Short.nullable() }).strict(),
  z.object({ type: z.literal("phone_number"), text: Short.nullable() }).strict(),
]);
export type ContentValue = z.infer<typeof ContentValue>;

/** Longest property name sent back to Notion (and sorted by); names are kept whole, not cut. */
export const CONTENT_PROPERTY_NAME_MAX = 1000;
const PropertyName = z.string().min(1).max(CONTENT_PROPERTY_NAME_MAX);
const Properties = z
  .record(PropertyName, ContentValue)
  .refine((x) => Object.keys(x).length <= 100, "too many properties");

/** PATCH a page's properties: only the changed ones, with the edit time the form was read at. */
export const ContentPageUpdate = z
  .object({
    lastEditedTime: z.string().min(1).max(40),
    properties: Properties,
  })
  .strict();
export type ContentPageUpdate = z.infer<typeof ContentPageUpdate>;

/** The code languages Notion accepts (API 2022-06-28), as a code block's `language`. */
export const CONTENT_CODE_LANGUAGES = [
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
] as const;

/** Most characters of text (and addresses) a body save takes; a longer body is edited in Notion. */
export const CONTENT_BODY_MAX = 500_000;
/** Most top-level blocks a body save takes. */
export const CONTENT_BLOCKS_MAX = 5000;

/**
 * A run of text with one set of styles (plan 5.6 item 7): bold, italic, strikethrough, inline code and a link.
 * Text may hold line breaks.
 */
export const ContentSpan = z
  .object({
    text: z.string().min(1).max(CONTENT_TEXT_MAX),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    strike: z.boolean().optional(),
    code: z.boolean().optional(),
    href: z
      .string()
      .max(NOTION_URL_MAX)
      .regex(/^(https?:\/\/|mailto:)/i)
      .optional(),
  })
  .strict();
export type ContentSpan = z.infer<typeof ContentSpan>;
const Spans = z.array(ContentSpan).max(100);

const listItem = <S extends z.ZodRawShape>(more: S) =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("bulleted_list_item"), text: Spans, ...more }).strict(),
    z.object({ type: z.literal("numbered_list_item"), text: Spans, ...more }).strict(),
    z.object({ type: z.literal("to_do"), text: Spans, checked: z.boolean(), ...more }).strict(),
  ]);
/** A list item under another: it has no children of its own. */
const ContentListLeaf = listItem({});
const ContentListItem = listItem({ children: z.array(ContentListLeaf).max(100).optional() });
export type ContentListItem = z.infer<typeof ContentListItem>;

/**
 * One block of a page body, only of the kinds this edits (plan 5.6 item 7): the names are Notion's block types.
 * Only a top-level list item has children, and only list items. `notion_image` is an image uploaded to Notion:
 * it can be moved, removed or given a new caption, never a new picture, and `url` (signed, for an hour) is
 * only for showing it.
 */
export const ContentBlock = z.union([
  ContentListItem,
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("paragraph"), text: Spans }).strict(),
    z.object({ type: z.literal("heading_1"), text: Spans }).strict(),
    z.object({ type: z.literal("heading_2"), text: Spans }).strict(),
    z.object({ type: z.literal("heading_3"), text: Spans }).strict(),
    z.object({ type: z.literal("quote"), text: Spans }).strict(),
    z
      .object({ type: z.literal("code"), language: z.string().max(40), text: z.string().max(CONTENT_TEXT_MAX) })
      .strict(),
    z.object({ type: z.literal("divider") }).strict(),
    z.object({ type: z.literal("image"), url: z.string().max(NOTION_URL_MAX), caption: Spans }).strict(),
    z
      .object({
        type: z.literal("notion_image"),
        id: z.string().max(100),
        url: z.string().max(4000).optional(),
        caption: Spans,
      })
      .strict(),
  ]),
]);
export type ContentBlock = z.infer<typeof ContentBlock>;

/** Characters of text and addresses in a body: what CONTENT_BODY_MAX counts. */
export function contentLength(blocks: readonly ContentBlock[]): number {
  const spans = (spans: readonly ContentSpan[]) => spans.reduce((n, s) => n + s.text.length + (s.href?.length ?? 0), 0);
  return blocks.reduce((n, b) => {
    switch (b.type) {
      case "code":
        return n + b.text.length;
      case "divider":
        return n;
      case "image":
        return n + b.url.length + spans(b.caption);
      case "notion_image":
        return n + spans(b.caption);
      case "bulleted_list_item":
      case "numbered_list_item":
      case "to_do":
        return n + spans(b.text) + contentLength(b.children ?? []);
      default:
        return n + spans(b.text);
    }
  }, 0);
}

const Blocks = z
  .array(ContentBlock)
  .max(CONTENT_BLOCKS_MAX)
  .refine((blocks) => contentLength(blocks) <= CONTENT_BODY_MAX, "body too long");

export const ContentPageCreate = z.object({ properties: Properties, blocks: Blocks.optional() }).strict();
export type ContentPageCreate = z.infer<typeof ContentPageCreate>;

export interface ContentOption {
  name: string;
  color: string;
}

/** One property of a database. */
export interface ContentSchemaProperty {
  name: string;
  type: string;
  editable: boolean;
  /** Choices of select, multi_select and status. */
  options?: ContentOption[];
}

/** GET /api/content/sources/:sourceId/databases/:databaseId */
export interface ContentDatabase {
  id: string;
  title: string;
  url: string | null;
  /** The title property first, then in name order. */
  properties: ContentSchemaProperty[];
  propertiesTruncated: boolean;
}

/** One property of a page: its value when editable, and always how it reads. */
export interface ContentProperty {
  name: string;
  type: string;
  value: ContentValue | null;
  display: string;
  /** Text with styles, links or mentions: saving a change writes plain text and drops them. */
  formatted?: boolean;
}

export interface ContentEntry {
  id: string;
  title: string;
  url: string | null;
  lastEditedTime: string;
  /** Each property's display text, by name. */
  cells: Record<string, string>;
}

/** GET /api/content/sources/:sourceId/databases/:databaseId/pages */
export interface ContentEntryList {
  entries: ContentEntry[];
  nextCursor: string | null;
}

export const ContentSortDirection = z.enum(["ascending", "descending"]);
export type ContentSortDirection = z.infer<typeof ContentSortDirection>;

/** GET /api/content/sources/:sourceId/databases/:databaseId/pages/:pageId */
export interface ContentPage {
  id: string;
  databaseId: string;
  title: string;
  url: string | null;
  lastEditedTime: string;
  properties: ContentProperty[];
}

/**
 * GET /api/content/sources/:sourceId/databases/:databaseId/pages/:pageId/body: the body as blocks (plan 5.6
 * item 7), empty when it cannot be edited here. `unsupported` names what keeps it read-only: block types, or
 * `children`, `color`, `underline`, `mention`, `equation`, `link`, `toggle`, `caption`, `code_format`,
 * `code_language`, `image_url`, `unwritable`, `too_long`.
 */
export interface ContentBody {
  blocks: ContentBlock[];
  editable: boolean;
  unsupported: string[];
  lastEditedTime: string;
}

/** PUT …/body: replaces the whole body. */
export const ContentBodyUpdate = z.object({ lastEditedTime: z.string().min(1).max(40), blocks: Blocks }).strict();
export type ContentBodyUpdate = z.infer<typeof ContentBodyUpdate>;
