import {
  CONTENT_PAGE_SIZE,
  CONTENT_PROPERTY_NAME_MAX,
  type ContentBody,
  type ContentBodyUpdate,
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
} from "@bukitjalil/shared";
import { isRecord } from "../bukit/guard.ts";
import { SiteError } from "../sites/location.ts";
import {
  type BodyItem,
  blocksToMarkdown,
  captionChanged,
  chunks,
  isHostedImage,
  isListType,
  markdownToItems,
  type RawBlock,
  storedOf,
} from "./notion-blocks.ts";
import { type DataSourceService, type NotionMethod, notionId } from "./service.ts";

/** Longest display text of one property; the list and read-only fields need no more. */
const DISPLAY_MAX = 500;
const TITLE_MAX = 200;
/** Notion appends at most 100 blocks per request, */
const BATCH = 100;
/** and at most 1000 block elements counting nested children. */
const BATCH_ELEMENTS = 1000;
/** Bodies longer than this are edited in Notion: reading and rewriting them would take minutes. */
const BODY_BLOCKS_MAX = 1000;

/** Notion refuses requests over about 500 KB; batches stay well under it. */
const BATCH_BYTES = 300_000;

/** Blocks in batches Notion takes in one request: at most 100, 1000 elements with children, and small enough. */
function batches(blocks: Record<string, unknown>[]): Record<string, unknown>[][] {
  const out: Record<string, unknown>[][] = [];
  let batch: Record<string, unknown>[] = [];
  let bytes = 0;
  let elements = 0;
  for (const block of blocks) {
    const size = Buffer.byteLength(JSON.stringify(block));
    const count = 1 + childCount(block);
    if (
      batch.length > 0 &&
      (batch.length >= BATCH || bytes + size > BATCH_BYTES || elements + count > BATCH_ELEMENTS)
    ) {
      out.push(batch);
      batch = [];
      bytes = 0;
      elements = 0;
    }
    batch.push(block);
    bytes += size;
    elements += count;
  }
  if (batch.length > 0) out.push(batch);
  return out;
}

/** How many children a block to write carries (the dialect nests one level, at most 100). */
function childCount(block: Record<string, unknown>): number {
  const data = typeof block.type === "string" ? block[block.type] : undefined;
  return isRecord(data) && Array.isArray(data.children) ? data.children.length : 0;
}

/** The title property first, then the others by name. */
const byTitleThenName = (a: { name: string; type: string }, b: { name: string; type: string }) =>
  Number(b.type === "title") - Number(a.type === "title") || a.name.localeCompare(b.name);

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
        name: str(p.name, CONTENT_PROPERTY_NAME_MAX) || key,
        type,
        editable: isEditablePropertyType(type),
      };
      const choices = isRecord(p[type]) ? (p[type] as Record<string, unknown>).options : undefined;
      if (Array.isArray(choices)) property.options = choices.flatMap(optionOf);
      properties.push(property);
    }
    properties.sort(byTitleThenName);
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

  /** A new page with the given properties and, optionally, a body. */
  async create(sourceId: string, databaseId: string, req: ContentPageCreate): Promise<ContentPage> {
    const items = req.markdown ? markdownToItems(req.markdown) : [];
    if (items.some((item) => item.kind === "keep")) throw new SiteError("content.body_images", 400);
    const [first = [], ...rest] = batches(items.flatMap((item) => (item.kind === "block" ? [item.block] : [])));
    const json = await this.call(
      sourceId,
      "POST",
      "/pages",
      {
        parent: { database_id: idOf(databaseId) },
        properties: payloadOf(req.properties),
        ...(first.length > 0 ? { children: first } : {}),
      },
      true,
    );
    const pageId = idOf(str(json.id, 100));
    try {
      for (const batch of rest) {
        await this.call(sourceId, "PATCH", `/blocks/${pageId}/children`, { children: batch }, true);
      }
    } catch (err) {
      // The client never learns the half-written page, so it goes to the trash: creating again then makes no
      // duplicate. Only if that fails too is the page left for the user to find.
      try {
        await this.call(sourceId, "PATCH", `/pages/${pageId}`, { archived: true }, true);
      } catch {
        throw new SiteError("content.body_partial", 503);
      }
      throw err;
    }
    return viewOf(json);
  }

  /** The body as Markdown, or what keeps it from being edited here. */
  async body(sourceId: string, databaseId: string, pageId: string): Promise<ContentBody> {
    const page = await this.read(sourceId, databaseId, pageId);
    const tree = await this.tree(sourceId, idOf(pageId));
    const { markdown, unsupported } = tree.tooLong
      ? { markdown: "", unsupported: ["too_long"] }
      : blocksToMarkdown(tree.blocks);
    return {
      markdown,
      editable: unsupported.length === 0,
      unsupported,
      lastEditedTime: str(page.last_edited_time, 40),
    };
  }

  /**
   * Replace the whole body (plan 5.6). The current body is read again first: an edit since the form was read
   * is a 409, and a body that holds blocks this cannot write is refused rather than dropped. The new blocks
   * go in before the old ones are deleted, so a failure half way leaves both rather than neither.
   */
  async saveBody(sourceId: string, databaseId: string, pageId: string, req: ContentBodyUpdate): Promise<ContentBody> {
    const page = await this.read(sourceId, databaseId, pageId);
    if (str(page.last_edited_time, 40) !== req.lastEditedTime) throw new SiteError("content.conflict", 409);
    const items = markdownToItems(req.markdown);
    const id = idOf(pageId);
    const tree = await this.tree(sourceId, id);
    if (tree.tooLong || blocksToMarkdown(tree.blocks).unsupported.length > 0) {
      throw new SiteError("content.body_unsupported", 409);
    }
    await this.replaceBody(
      sourceId,
      id,
      tree.blocks.map((b) => b.block),
      items,
    );
    const after = await this.call(sourceId, "GET", `/pages/${id}`);
    return {
      markdown: blocksToMarkdown(storedOf(items)).markdown,
      editable: true,
      unsupported: [],
      lastEditedTime: str(after.last_edited_time, 40),
    };
  }

  /**
   * Write `items` in place of the old top-level blocks. A kept Notion-hosted image cannot be written again,
   * so it stays where it is: the new blocks go in around it with `after`, which needs an old block before the
   * first kept image to anchor what comes before that image.
   */
  private async replaceBody(sourceId: string, pageId: string, old: Record<string, unknown>[], items: BodyItem[]) {
    const ids = old.map((b) => notionId(str(b.id, 100)) ?? "");
    const segments: Record<string, unknown>[][] = [[]];
    const keeps: { id: string; index: number; caption: Record<string, unknown>[] }[] = [];
    for (const item of items) {
      if (item.kind === "block") {
        segments.at(-1)?.push(item.block);
        continue;
      }
      const index = ids.indexOf(item.id);
      const previous = keeps.at(-1)?.index ?? -1;
      if (index < 0 || !isHostedImage(old[index] ?? {}) || index <= previous)
        throw new SiteError("content.body_images", 400);
      keeps.push({ id: item.id, index, caption: item.caption });
      segments.push([]);
    }
    const first = keeps[0];
    if (first && first.index === 0 && (segments[0]?.length ?? 0) > 0) throw new SiteError("content.body_images", 400);

    let started = false;
    const append = async (blocks: Record<string, unknown>[], after?: string) => {
      // With an anchor, the batches go in last first, each right after it, so they end up in order.
      const list = batches(blocks);
      for (const batch of after ? list.reverse() : list) {
        await this.call(
          sourceId,
          "PATCH",
          `/blocks/${pageId}/children`,
          { children: batch, ...(after ? { after } : {}) },
          true,
        );
        started = true;
      }
    };
    try {
      if (!first) await append(segments[0] ?? []);
      else {
        for (const [s, segment] of segments.entries()) {
          if (segment.length === 0) continue;
          await append(segment, s === 0 ? ids[first.index - 1] : keeps[s - 1]?.id);
        }
        for (const keep of keeps) {
          if (!captionChanged(old[keep.index] ?? {}, keep.caption)) continue;
          await this.call(sourceId, "PATCH", `/blocks/${keep.id}`, { image: { caption: keep.caption } }, true);
          started = true;
        }
      }
      const kept = new Set(keeps.map((k) => k.id));
      for (const id of ids) {
        if (kept.has(id)) continue;
        await this.call(sourceId, "DELETE", `/blocks/${id}`, undefined, true);
        started = true;
      }
    } catch (err) {
      if (started && err instanceof SiteError) throw new SiteError("content.body_partial", 503);
      throw err;
    }
  }

  /** The page's blocks, with the children of list items (the only blocks that may have them here). */
  private async tree(sourceId: string, pageId: string): Promise<{ blocks: RawBlock[]; tooLong: boolean }> {
    const counter = { count: 0 };
    const top = await this.children(sourceId, pageId, counter);
    if (!top) return { blocks: [], tooLong: true };
    const blocks: RawBlock[] = [];
    for (const block of top) {
      const raw: RawBlock = { block };
      if (block.has_children === true && isListType(str(block.type, 50))) {
        const children = await this.children(sourceId, idOf(str(block.id, 100)), counter);
        if (!children) return { blocks: [], tooLong: true };
        raw.children = children.map((child) => ({ block: child }));
      }
      blocks.push(raw);
    }
    return { blocks, tooLong: false };
  }

  /** One block's children, all pages of them; null once the body has more blocks than this edits. */
  private async children(
    sourceId: string,
    blockId: string,
    counter: { count: number },
  ): Promise<Record<string, unknown>[] | null> {
    const out: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    do {
      const json = await this.call(
        sourceId,
        "GET",
        `/blocks/${blockId}/children?page_size=${BATCH}${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      const results = Array.isArray(json.results) ? json.results.filter(isRecord) : [];
      counter.count += results.length;
      if (counter.count > BODY_BLOCKS_MAX) return null;
      out.push(...results);
      cursor = json.has_more === true && typeof json.next_cursor === "string" ? json.next_cursor : null;
    } while (cursor);
    return out;
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

  private call(sourceId: string, method: NotionMethod, path: string, body?: Record<string, unknown>, write = false) {
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
  // The full name: a change is sent back under it. Sorted before the cut, so the title is never cut off.
  return Object.entries(raw)
    .map(([name, value]) => propertyOf(name, isRecord(value) ? value : {}))
    .sort(byTitleThenName)
    .slice(0, NOTION_MAX_PROPERTIES);
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
  return chunks(text).map((content) => ({ type: "text", text: { content } }));
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
