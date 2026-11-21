import {
  CONTENT_PAGE_SIZE,
  type ContentDatabase,
  type ContentEntryList,
  type ContentOption,
  type ContentPage,
  type ContentPageCreate,
  type ContentPageUpdate,
  type ContentProperty,
  type ContentSchemaProperty,
  type ContentSortDirection,
  type ContentValue,
  isEditablePropertyType,
  NOTION_MAX_PROPERTIES,
  NOTION_TEXT_SEGMENT,
} from "@bukitjalil/shared";
import { isRecord } from "../bukit/guard.ts";
import { SiteError } from "../sites/location.ts";
import { type DataSourceService, notionId } from "./service.ts";

/** Longest display text of one property; the list and read-only fields need no more. */
const DISPLAY_MAX = 500;
const TITLE_MAX = 200;

export interface EntryQuery {
  cursor?: string;
  search?: string;
  /** A property name; absent sorts by last edit time. */
  sort?: string;
  direction?: ContentSortDirection;
}

/**
 * Content management (plan 5.6): read and write the pages of a Notion database with a data source's token.
 * Every call comes from a user action; nothing here is logged, cached or handed to the AI.
 */
export class NotionContentService {
  constructor(private readonly dataSources: DataSourceService) {}

  async database(sourceId: string, databaseId: string): Promise<ContentDatabase> {
    const json = await this.call(sourceId, "GET", `/databases/${idOf(databaseId)}`);
    const raw = isRecord(json.properties) ? json.properties : {};
    const properties: ContentSchemaProperty[] = [];
    for (const [key, value] of Object.entries(raw)) {
      const p = isRecord(value) ? value : {};
      const type = str(p.type, 50) || "unknown";
      const property: ContentSchemaProperty = {
        name: str(p.name, TITLE_MAX) || key,
        type,
        editable: isEditablePropertyType(type),
      };
      const choices = isRecord(p[type]) ? (p[type] as Record<string, unknown>).options : undefined;
      if (Array.isArray(choices)) property.options = choices.flatMap(optionOf);
      properties.push(property);
    }
    properties.sort((a, b) => Number(b.type === "title") - Number(a.type === "title") || a.name.localeCompare(b.name));
    return {
      id: str(json.id, 100) || databaseId,
      title: plain(json.title).slice(0, TITLE_MAX),
      url: url(json.url),
      properties: properties.slice(0, NOTION_MAX_PROPERTIES),
      propertiesTruncated: properties.length > NOTION_MAX_PROPERTIES,
    };
  }

  async entries(sourceId: string, databaseId: string, query: EntryQuery): Promise<ContentEntryList> {
    const body: Record<string, unknown> = {
      page_size: CONTENT_PAGE_SIZE,
      sorts: [
        query.sort
          ? { property: query.sort, direction: query.direction ?? "ascending" }
          : { timestamp: "last_edited_time", direction: query.direction ?? "descending" },
      ],
    };
    if (query.cursor) body.start_cursor = query.cursor;
    // The title property's id is always "title", whatever it is named.
    if (query.search) body.filter = { property: "title", title: { contains: query.search } };
    const json = await this.call(sourceId, "POST", `/databases/${idOf(databaseId)}/query`, body);
    const results = Array.isArray(json.results) ? json.results : [];
    return {
      entries: results.filter(isRecord).map((page) => {
        const properties = propertiesOf(page);
        return {
          id: str(page.id, 100),
          title: titleOf(properties),
          url: url(page.url),
          lastEditedTime: str(page.last_edited_time, 40),
          cells: Object.fromEntries(properties.map((p) => [p.name, p.display])),
        };
      }),
      nextCursor: json.has_more === true && typeof json.next_cursor === "string" ? json.next_cursor : null,
    };
  }

  async page(sourceId: string, databaseId: string, pageId: string): Promise<ContentPage> {
    return viewOf(await this.read(sourceId, databaseId, pageId));
  }

  /**
   * Write the changed properties. Notion's edit time is read again first: another edit since the form was
   * read is a 409 rather than overwritten. Two requests apart, a change in between can still slip through.
   */
  async update(sourceId: string, databaseId: string, pageId: string, req: ContentPageUpdate): Promise<ContentPage> {
    const current = await this.read(sourceId, databaseId, pageId);
    if (str(current.last_edited_time, 40) !== req.lastEditedTime) throw new SiteError("content.conflict", 409);
    if (Object.keys(req.properties).length === 0) return viewOf(current);
    const json = await this.call(
      sourceId,
      "PATCH",
      `/pages/${idOf(pageId)}`,
      { properties: payloadOf(req.properties) },
      true,
    );
    return viewOf(json);
  }

  async create(sourceId: string, databaseId: string, req: ContentPageCreate): Promise<ContentPage> {
    const json = await this.call(
      sourceId,
      "POST",
      "/pages",
      { parent: { database_id: idOf(databaseId) }, properties: payloadOf(req.properties) },
      true,
    );
    return viewOf(json);
  }

  /** Move the page to Notion's trash; it is not deleted for good (plan 5.6). */
  async trash(sourceId: string, databaseId: string, pageId: string): Promise<void> {
    await this.read(sourceId, databaseId, pageId);
    await this.call(sourceId, "PATCH", `/pages/${idOf(pageId)}`, { archived: true }, true);
  }

  /** A page of this database, not in the trash. */
  private async read(sourceId: string, databaseId: string, pageId: string): Promise<Record<string, unknown>> {
    const json = await this.call(sourceId, "GET", `/pages/${idOf(pageId)}`);
    const parent = isRecord(json.parent) ? json.parent : {};
    const parentId = typeof parent.database_id === "string" ? notionId(parent.database_id) : null;
    if (parentId !== idOf(databaseId) || json.archived === true || json.in_trash === true) {
      throw new SiteError("content.not_in_database", 404);
    }
    return json;
  }

  private call(
    sourceId: string,
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: Record<string, unknown>,
    write = false,
  ) {
    return this.dataSources.notionCall(sourceId, method, path, body, write);
  }
}

/** A database or page id as Notion's 32 hex digits; anything else never reaches a URL. */
function idOf(value: string): string {
  const id = notionId(value);
  if (!id) throw new SiteError("content.bad_id", 400);
  return id;
}

function viewOf(page: Record<string, unknown>): ContentPage {
  const properties = propertiesOf(page);
  const parent = isRecord(page.parent) ? page.parent : {};
  return {
    id: str(page.id, 100),
    databaseId: str(parent.database_id, 100),
    title: titleOf(properties),
    url: url(page.url),
    lastEditedTime: str(page.last_edited_time, 40),
    properties,
  };
}

function titleOf(properties: ContentProperty[]): string {
  return (properties.find((p) => p.type === "title")?.display ?? "").slice(0, TITLE_MAX);
}

/** A page's properties, the title first and the rest by name. */
function propertiesOf(page: Record<string, unknown>): ContentProperty[] {
  const raw = isRecord(page.properties) ? page.properties : {};
  const properties = Object.entries(raw)
    .slice(0, NOTION_MAX_PROPERTIES)
    .map(([name, value]) => propertyOf(name.slice(0, TITLE_MAX), isRecord(value) ? value : {}));
  return properties.sort(
    (a, b) => Number(b.type === "title") - Number(a.type === "title") || a.name.localeCompare(b.name),
  );
}

function propertyOf(name: string, p: Record<string, unknown>): ContentProperty {
  const type = str(p.type, 50) || "unknown";
  const value = formValue(type, p[type]);
  const property: ContentProperty = {
    name,
    type,
    value,
    display: (value ? displayOfValue(value) : displayOf(type, p[type])).slice(0, DISPLAY_MAX),
  };
  if ((type === "title" || type === "rich_text") && formatted(p[type])) property.formatted = true;
  return property;
}

/** The form value of an editable property; null for the read-only types. */
export function formValue(type: string, raw: unknown): ContentValue | null {
  const record = isRecord(raw) ? raw : null;
  switch (type) {
    case "title":
    case "rich_text":
      return { type, text: plain(raw) };
    case "number":
      return { type, number: typeof raw === "number" && Number.isFinite(raw) ? raw : null };
    case "select":
    case "status":
      return { type, option: record && typeof record.name === "string" ? record.name : null };
    case "multi_select":
      return {
        type,
        options: Array.isArray(raw)
          ? raw.flatMap((x) => (isRecord(x) && typeof x.name === "string" ? [x.name] : []))
          : [],
      };
    case "date":
      return { type, start: record ? strOrNull(record.start) : null, end: record ? strOrNull(record.end) : null };
    case "checkbox":
      return { type, checked: raw === true };
    case "url":
    case "email":
    case "phone_number":
      return { type, text: strOrNull(raw) };
    default:
      return null;
  }
}

function displayOfValue(value: ContentValue): string {
  switch (value.type) {
    case "title":
    case "rich_text":
      return value.text;
    case "number":
      return value.number === null ? "" : String(value.number);
    case "select":
    case "status":
      return value.option ?? "";
    case "multi_select":
      return value.options.join(", ");
    case "date":
      return value.start ? (value.end ? `${value.start} → ${value.end}` : value.start) : "";
    case "checkbox":
      return value.checked ? "✓" : "";
    default:
      return value.text ?? "";
  }
}

/** How a read-only property reads. A relation reads as its count, which the UI words. */
function displayOf(type: string, raw: unknown): string {
  const record = isRecord(raw) ? raw : null;
  switch (type) {
    case "relation":
      return Array.isArray(raw) ? String(raw.length) : "0";
    case "people":
      return Array.isArray(raw)
        ? raw
            .map((x) => (isRecord(x) ? str(x.name, 100) : ""))
            .filter(Boolean)
            .join(", ")
        : "";
    case "files":
      return Array.isArray(raw)
        ? raw
            .map((x) => (isRecord(x) ? str(x.name, 200) : ""))
            .filter(Boolean)
            .join(", ")
        : "";
    case "created_time":
    case "last_edited_time":
      return str(raw, 40);
    case "created_by":
    case "last_edited_by":
      return record ? str(record.name, 100) : "";
    case "unique_id":
      return record && typeof record.number === "number"
        ? `${typeof record.prefix === "string" ? `${record.prefix}-` : ""}${record.number}`
        : "";
    case "formula":
    case "rollup": {
      if (!record) return "";
      const inner = str(record.type, 50);
      if (inner === "array") return Array.isArray(record.array) ? String(record.array.length) : "";
      const value = formValue(inner, record[inner]);
      if (value) return displayOfValue(value);
      return typeof record[inner] === "string" || typeof record[inner] === "boolean" ? String(record[inner]) : "";
    }
    default:
      return "";
  }
}

/** The Notion request body of changed properties. Types are as the request schema allows. */
export function payloadOf(properties: Record<string, ContentValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).map(([name, value]) => [name, propertyPayload(value)]));
}

function propertyPayload(value: ContentValue): Record<string, unknown> {
  switch (value.type) {
    case "title":
    case "rich_text":
      return { [value.type]: segments(value.text) };
    case "number":
      return { number: value.number };
    case "select":
    case "status":
      return { [value.type]: value.option === null ? null : { name: value.option } };
    case "multi_select":
      return { multi_select: [...new Set(value.options)].map((name) => ({ name })) };
    case "date":
      return { date: value.start ? { start: value.start, end: value.end } : null };
    case "checkbox":
      return { checkbox: value.checked };
    default:
      return { [value.type]: value.text?.trim() || null };
  }
}

/** Text as rich text segments of at most 2000 characters, never splitting a surrogate pair. */
export function segments(text: string): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(at + NOTION_TEXT_SEGMENT, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push({ type: "text", text: { content: text.slice(at, end) } });
    at = end;
  }
  return parts;
}

function optionOf(raw: unknown): ContentOption[] {
  if (!isRecord(raw) || typeof raw.name !== "string") return [];
  return [{ name: raw.name.slice(0, 100), color: str(raw.color, 30) || "default" }];
}

/** Rich text that plain text cannot hold: styles, colors, links, mentions or equations. */
function formatted(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((part) => {
    if (!isRecord(part)) return false;
    if (part.type !== "text" || part.href) return true;
    const annotations = isRecord(part.annotations) ? part.annotations : {};
    return Object.entries(annotations).some(([key, v]) => (key === "color" ? v !== "default" : v === true));
  });
}

function plain(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((part) => (isRecord(part) && typeof part.plain_text === "string" ? part.plain_text : "")).join("");
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Only an https link to Notion is handed to the UI as a link. */
function url(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && (parsed.hostname === "notion.so" || parsed.hostname.endsWith(".notion.so"))
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}
