import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type DataSourceRequest,
  type ErrorCode,
  NOTION_MAX_PROPERTIES,
  type NotionDatabase,
  type NotionProperty,
  type SavedDataSource,
} from "@bukitjalil/shared";
import { isRecord } from "../bukit/guard.ts";
import { SiteError } from "../sites/location.ts";
import { JsonFile, JsonFileError, type StoredJson } from "../store/json-file.ts";

interface Row {
  id: string;
  name: string;
  created_at: string;
}

export const MAX_TOKEN_FILE = 256 * 1024;
const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_TIMEOUT_MS = 15_000;
const NOTION_PAGES = 5;

/**
 * Saved Notion sources: each keeps its own integration token. Markdown needs no saved source, so a
 * site without one of these is created with the starter's Markdown content.
 */
export class DataSourceService {
  private readonly tokens: StoredJson;

  constructor(
    private readonly opts: {
      db: DatabaseSync;
      /** Per-data-source Notion tokens (0600); never the database and never an API response. */
      /** A path (plain 0600 file) or the secret store's file (plan 6.7). */
      tokenFile: string | StoredJson;
      /** null in tests and offline mode: listing Notion databases is refused. */
      fetchImpl: typeof fetch | null;
      notionApi?: string;
    },
  ) {
    this.tokens =
      typeof opts.tokenFile === "string" ? new JsonFile(opts.tokenFile, { maxBytes: MAX_TOKEN_FILE }) : opts.tokenFile;
  }

  list(): SavedDataSource[] {
    const rows = this.opts.db
      .prepare("SELECT id, name, created_at FROM data_sources WHERE platform = 'notion' ORDER BY rowid")
      .all() as unknown as Row[];
    const tokens = this.readTokens();
    return rows.map((row) => this.view(row, tokens));
  }

  get(id: string): SavedDataSource {
    return this.view(this.row(id), this.readTokens());
  }

  create(req: DataSourceRequest): SavedDataSource {
    this.assertName(req.name);
    const token = req.token?.trim();
    if (!token) throw new SiteError("datasource.no_token", 400);
    const id = newId();
    // Token first: a corrupt token file must not leave a database row behind.
    this.writeToken(id, token);
    try {
      this.opts.db
        .prepare(
          "INSERT INTO data_sources (id, name, platform, config_json, created_at) VALUES (?, ?, 'notion', '{}', ?)",
        )
        .run(id, req.name, new Date().toISOString());
    } catch (err) {
      try {
        this.removeToken(id);
      } catch {
        // The database error is the useful one.
      }
      throw err;
    }
    return this.get(id);
  }

  update(id: string, req: DataSourceRequest): SavedDataSource {
    this.row(id);
    this.assertName(req.name, id);
    // An omitted token keeps the stored one; a null token makes the source unusable, so refuse it.
    const token = req.token === undefined ? this.token(id) : req.token.trim() || null;
    if (token === null) throw new SiteError("datasource.no_token", 400);
    if (req.token !== undefined) this.writeToken(id, token);
    this.opts.db.prepare("UPDATE data_sources SET name = ? WHERE id = ?").run(req.name, id);
    return this.get(id);
  }

  remove(id: string): void {
    this.row(id);
    const used = this.opts.db
      .prepare("SELECT COUNT(*) AS count FROM sites WHERE notion_data_source_id = ?")
      .get(id) as { count: number };
    if (used.count > 0) throw new SiteError("datasource.in_use", 409, { count: String(used.count) });
    // Token first: never leave a secret file entry without its source.
    this.removeToken(id);
    this.opts.db.prepare("DELETE FROM data_sources WHERE id = ?").run(id);
  }

  /** Remove token entries whose data source no longer exists; returns the number removed. */
  pruneUnknownTokens(): number {
    const rows = this.opts.db.prepare("SELECT id FROM data_sources").all() as { id: string }[];
    const known = new Set(rows.map((row) => row.id));
    const tokens = this.readTokens();
    const kept = Object.fromEntries(Object.entries(tokens).filter(([id]) => known.has(id)));
    const removed = Object.keys(tokens).length - Object.keys(kept).length;
    if (removed > 0) this.writeTokens(kept);
    return removed;
  }

  /** Remove temporary files left by a killed write; returns the number removed. */
  cleanupTempFiles(): number {
    return this.tokens.cleanupTempFiles();
  }

  /** The Notion token for a data source, or null. */
  token(id: string): string | null {
    return this.readTokens()[id] ?? null;
  }

  /**
   * Databases the saved Notion token can read. The user must share each database with the integration
   * in Notion first; this is the list the site-creation picker shows for one data source.
   */
  async notionDatabases(id: string): Promise<NotionDatabase[]> {
    this.get(id);
    const token = this.token(id);
    if (!token) throw new SiteError("datasource.no_token", 409);
    if (!this.opts.fetchImpl) throw new SiteError("datasource.notion_offline", 503);

    const databases: NotionDatabase[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < NOTION_PAGES; page++) {
      const body: Record<string, unknown> = {
        filter: { value: "database", property: "object" },
        page_size: 100,
      };
      if (cursor) body.start_cursor = cursor;
      const json = await this.notion(token, "POST", "/search", body);
      const results = Array.isArray(json.results) ? json.results : [];
      for (const item of results) {
        if (!item || typeof item !== "object") continue;
        const value = item as { id?: unknown; title?: unknown };
        if (typeof value.id !== "string") continue;
        databases.push({ id: value.id, title: titleOf(value.title) ?? value.id });
      }
      cursor = typeof json.next_cursor === "string" ? json.next_cursor : null;
      if (json.has_more !== true || !cursor) break;
    }
    return databases.sort((a, b) => a.title.localeCompare(b.title));
  }

  /**
   * A database's title and properties (plan 5.4), read with `token`. `databaseId` comes from site.yaml, so
   * it must look like a Notion id before it goes into the URL.
   */
  async notionSchema(
    token: string,
    databaseId: string,
  ): Promise<{ title: string | null; properties: NotionProperty[]; propertiesTruncated: boolean }> {
    if (!this.opts.fetchImpl) throw new SiteError("datasource.notion_offline", 503);
    const id = notionId(databaseId);
    if (!id) throw new SiteError("datasource.notion_bad_database_id", 400);
    const json = await this.notion(token, "GET", `/databases/${id}`);
    const raw = isRecord(json.properties) ? json.properties : {};
    const properties: NotionProperty[] = [];
    for (const [key, value] of Object.entries(raw)) {
      const p = isRecord(value) ? value : {};
      const name = (typeof p.name === "string" ? p.name : key).slice(0, 200);
      properties.push({ name, type: typeof p.type === "string" ? p.type.slice(0, 50) : "unknown" });
    }
    // Title first, then by name: Notion returns properties in no useful order.
    properties.sort((a, b) => Number(b.type === "title") - Number(a.type === "title") || a.name.localeCompare(b.name));
    return {
      title: titleOf(json.title)?.slice(0, 200) ?? null,
      properties: properties.slice(0, NOTION_MAX_PROPERTIES),
      propertiesTruncated: properties.length > NOTION_MAX_PROPERTIES,
    };
  }

  private row(id: string): Row {
    const row = this.opts.db
      .prepare("SELECT id, name, created_at FROM data_sources WHERE id = ? AND platform = 'notion'")
      .get(id) as unknown as Row | undefined;
    if (!row) throw new SiteError("datasource.not_found", 404);
    return row;
  }

  private assertName(name: string, except = ""): void {
    const row = this.opts.db.prepare("SELECT id FROM data_sources WHERE name = ? AND id <> ?").get(name, except) as
      | { id: string }
      | undefined;
    if (row) throw new SiteError("datasource.name_exists", 409);
  }

  private view(row: Row, tokens: Record<string, string>): SavedDataSource {
    const token = tokens[row.id] ?? null;
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      platform: "notion",
      hasToken: token !== null,
      tokenLast4: token !== null && token.length > 8 ? token.slice(-4) : null,
    };
  }

  /** One Notion API call; a failure becomes the error code that says what to do (plan 5.4). */
  private async notion(
    token: string,
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NOTION_TIMEOUT_MS);
    try {
      const res = await this.opts.fetchImpl?.(`${this.opts.notionApi ?? NOTION_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "User-Agent": "BukitJalil",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        // The token goes only to the Notion API: never follow a redirect elsewhere.
        redirect: "error",
      });
      if (!res?.ok) throw new SiteError(notionFailure(res?.status ?? 0), 503);
      const json: unknown = await res.json();
      return json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    } catch (err) {
      if (err instanceof SiteError) throw err;
      throw new SiteError("datasource.notion_offline", 503);
    } finally {
      clearTimeout(timer);
    }
  }

  private readTokens(): Record<string, string> {
    try {
      const value = this.tokens.read();
      if (value === undefined) return {};
      if (!isRecord(value)) throw new JsonFileError(this.tokens.file, "token file is not an object");
      const tokens: Record<string, string> = {};
      for (const [id, token] of Object.entries(value)) {
        if (typeof token !== "string") throw new JsonFileError(this.tokens.file, "token is not a string");
        tokens[id] = token;
      }
      return tokens;
    } catch (err) {
      if (err instanceof JsonFileError) throw new SiteError("storage.unreadable", 500);
      throw err;
    }
  }

  private writeToken(id: string, token: string): void {
    const tokens = this.readTokens();
    tokens[id] = token;
    this.writeTokens(tokens);
  }

  private removeToken(id: string): void {
    const tokens = this.readTokens();
    if (!(id in tokens)) return;
    delete tokens[id];
    this.writeTokens(tokens);
  }

  private writeTokens(tokens: Record<string, string>): void {
    try {
      this.tokens.write(tokens);
    } catch (err) {
      if (err instanceof JsonFileError) throw new SiteError(err.code, 500);
      throw err;
    }
  }
}

/** Notion's HTTP status as the code the UI explains. */
function notionFailure(status: number): ErrorCode {
  if (status === 401) return "datasource.notion_unauthorized";
  if (status === 404) return "datasource.notion_not_shared";
  if (status === 403) return "datasource.notion_forbidden";
  if (status === 429) return "datasource.notion_rate_limited";
  return "datasource.notion_failed";
}

/** A Notion id as 32 lowercase hex digits (with or without dashes, as Notion URLs show it), or null. */
export function notionId(value: string): string | null {
  const hex = value.trim().replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
}

function newId(): string {
  return `ds_${randomBytes(6).toString("hex")}`;
}

function titleOf(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const text = value
    .map((part) =>
      part && typeof part === "object" && typeof (part as { plain_text?: unknown }).plain_text === "string"
        ? (part as { plain_text: string }).plain_text
        : "",
    )
    .join("")
    .trim();
  return text || null;
}
