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

/** Longest body Markdown a save takes (Notion takes about 500 KB per request). */
export const CONTENT_BODY_MAX = 500_000;
const Markdown = z.string().max(CONTENT_BODY_MAX);

export const ContentPageCreate = z.object({ properties: Properties, markdown: Markdown.optional() }).strict();
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
 * GET /api/content/sources/:sourceId/databases/:databaseId/pages/:pageId/body: the body as Markdown (plan 5.6
 * item 7). `unsupported` names what keeps it read-only: block types, or `children`, `color`, `underline`,
 * `mention`, `equation`, `link`, `toggle`, `caption`, `code_format`, `code_language`, `image_url`, `too_long`.
 */
export interface ContentBody {
  markdown: string;
  editable: boolean;
  unsupported: string[];
  lastEditedTime: string;
}

/** PUT …/body: replaces the whole body. */
export const ContentBodyUpdate = z.object({ lastEditedTime: z.string().min(1).max(40), markdown: Markdown }).strict();
export type ContentBodyUpdate = z.infer<typeof ContentBodyUpdate>;
