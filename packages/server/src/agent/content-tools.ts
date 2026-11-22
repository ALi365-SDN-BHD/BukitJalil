import type { ContentRef } from "@bukitjalil/shared";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { contentToMarkdown } from "../data-sources/notion-blocks.ts";
import type { NotionContentService } from "../data-sources/notion-content.ts";
import { notionId } from "../data-sources/service.ts";

/**
 * The read tools of a content conversation (content editor and AI design, A1). They read one Notion database
 * through the server with its data source's token; the token never reaches the model. What they return goes
 * into the conversation and to the model provider, which the panel tells the user.
 */
export const CONTENT_READ_TOOLS = ["read_schema", "search_entries", "read_entry"] as const;

/** Longest tool result; a longer one is cut and says so. */
export const MAX_RESULT_CHARS = 60_000;

export interface ContentToolOptions {
  content: NotionContentService;
  ref: ContentRef;
  /** The entry the user has open in the editor now, or null (the entry list, or a new entry). */
  current: () => string | null;
}

type Result = { content: { type: "text"; text: string }[]; details: unknown };
const json = (value: unknown): Result => {
  let text = JSON.stringify(value, null, 2);
  if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n… (cut: the result is too long)`;
  return { content: [{ type: "text", text }], details: null };
};
const object = (properties: Record<string, unknown>, required: string[] = []) =>
  ({ type: "object", properties, required, additionalProperties: false }) as never;
const str = (description: string, maxLength = 200) => ({ type: "string", description, maxLength });

/** The entry a tool call names, or the open one; refuses (to the model) when there is neither. */
export function entryOf(id: unknown, current: () => string | null): string {
  if (typeof id === "string" && id !== "") {
    const entry = notionId(id);
    if (!entry) throw new Error(`"${id}" is not an entry id: use an id from search_entries.`);
    return entry;
  }
  const open = current();
  if (!open) throw new Error("The user has no entry open: ask which entry, or find it with search_entries.");
  return open;
}

export function createContentReadTools({ content, ref, current }: ContentToolOptions): ToolDefinition[] {
  const { sourceId, databaseId } = ref;
  return [
    {
      name: "read_schema",
      label: "Read fields",
      description:
        "The database's title and properties: each property's name, type, whether it can be edited, and the options of select, multi_select and status properties.",
      parameters: object({}),
      async execute() {
        const db = await content.database(sourceId, databaseId);
        return json({ title: db.title, properties: db.properties, propertiesTruncated: db.propertiesTruncated });
      },
    },
    {
      name: "search_entries",
      label: "Search entries",
      description:
        "Entries of the database, 50 at a time: id, title, last edit time and each property's text. Filter by words in the title; sort by a property name (default: last edited first). Pass nextCursor back for the next page.",
      parameters: object({
        search: str("Words the title contains."),
        sort: str("A property name to sort by.", 1000),
        direction: { type: "string", enum: ["ascending", "descending"] },
        cursor: str("nextCursor of the previous page."),
      }),
      async execute(
        _id,
        params: { search?: string; sort?: string; direction?: "ascending" | "descending"; cursor?: string },
      ) {
        const list = await content.entries(sourceId, databaseId, {
          ...(params.search ? { search: params.search } : {}),
          ...(params.sort ? { sort: params.sort } : {}),
          ...(params.direction ? { direction: params.direction } : {}),
          ...(params.cursor ? { cursor: params.cursor } : {}),
        });
        return json({
          entries: list.entries.map(({ id, title, lastEditedTime, cells }) => ({ id, title, lastEditedTime, cells })),
          nextCursor: list.nextCursor,
        });
      },
    },
    {
      name: "read_entry",
      label: "Read entry",
      description:
        "One entry's properties and body. Without entryId it reads the entry the user has open, which can change between messages. The body is Markdown (headings 1-3, lists, to-dos, quotes, code, dividers, images, bold, italic, strikethrough, inline code, links); a body with other Notion blocks cannot be read or edited here, and the result says why.",
      parameters: object({ entryId: str("An entry id from search_entries; omit for the open entry.", 40) }),
      async execute(_id, params: { entryId?: string }) {
        const pageId = entryOf(params.entryId, current);
        const [page, body] = await Promise.all([
          content.page(sourceId, databaseId, pageId),
          content.body(sourceId, databaseId, pageId),
        ]);
        return json({
          id: page.id,
          open: pageId === current(),
          title: page.title,
          lastEditedTime: page.lastEditedTime,
          properties: page.properties.map(({ name, type, value, display }) => ({
            name,
            type,
            editable: value !== null,
            value: display,
          })),
          body: body.editable ? contentToMarkdown(body.blocks) : null,
          bodyReadOnly: body.editable ? null : body.unsupported,
        });
      },
    },
  ];
}
