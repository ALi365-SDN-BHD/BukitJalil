import { z } from "zod";

/**
 * Saved non-default content sources (plan 6.5). Markdown is built in: a new site always gets the
 * starter's Markdown sources unless a saved Notion source is picked.
 */
const Name = z.string().trim().min(1).max(100);
const Token = z
  .string()
  .trim()
  .max(4096)
  .refine((s) => !/[\s\p{Cc}]/u.test(s), "must not contain spaces or control characters");

export const DataSourceRequest = z
  .object({
    platform: z.literal("notion"),
    name: Name,
    /** Omitted on edit keeps the stored token; a saved source must always have one. */
    token: Token.optional(),
  })
  .strict();
export type DataSourceRequest = z.infer<typeof DataSourceRequest>;

export interface SavedNotionDataSource {
  id: string;
  name: string;
  createdAt: string;
  platform: "notion";
  /** The token itself never leaves the server. */
  hasToken: boolean;
  tokenLast4: string | null;
}

export type SavedDataSource = SavedNotionDataSource;

/** One database the Notion integration token can read, for the site-creation picker. */
export interface NotionDatabase {
  id: string;
  title: string;
}

/** One property (field) of a Notion database (plan 5.4). */
export interface NotionProperty {
  name: string;
  /** Notion's property type, such as "title", "rich_text", "checkbox", "select". */
  type: string;
}

/** GET /api/sites/:siteId/notion/sources/:index: a Notion source's database, read with the bound token. */
export interface NotionSourceSchema {
  index: number;
  /** As written in the default branch's site.yaml. */
  databaseId: string;
  title: string | null;
  properties: NotionProperty[];
  /** The database has more properties than NOTION_MAX_PROPERTIES. */
  propertiesTruncated: boolean;
  readAt: string;
}

export const NOTION_MAX_PROPERTIES = 200;

/**
 * A Notion failure recognised in Bukit's output (plan 5.4), shown with what to do about it. The texts come
 * from Bukit 2.0.15's NotionClient and content parser.
 */
export type NotionProblem =
  | "unauthorized"
  | "not_shared"
  | "forbidden"
  | "rate_limited"
  | "property_missing"
  | "network";

export interface NotionDatabasesResponse {
  databases: NotionDatabase[];
}

/** How a selected Notion database is used on a new site: posts, pages, or template-only data. */
export const NotionDatabaseUse = z.enum(["post", "page", "data"]);
export type NotionDatabaseUse = z.infer<typeof NotionDatabaseUse>;

/** One database picked for a new Notion-backed site. */
export const NotionDatabaseChoice = z
  .object({
    databaseId: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    use: NotionDatabaseUse,
  })
  .strict();
export type NotionDatabaseChoice = z.infer<typeof NotionDatabaseChoice>;
