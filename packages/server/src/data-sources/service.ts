import { randomBytes } from "node:crypto";
import {
  type DataSourceRequest,
  type ErrorCode,
  NOTION_MAX_PROPERTIES,
  type NotionDatabase,
  type NotionProperty,
  type SavedDataSource,
} from "@bukitjalil/shared";
import { isRecord } from "../bukit/guard.ts";
import type { FieldVault } from "../security/vault.ts";
import { SiteError } from "../sites/location.ts";
import type { Db } from "../store/db.ts";

interface Row {
  id: string;
  name: string;
  created_at: string;
  token_ciphertext: string | null;
}

const TABLE = "data_sources";
const COLUMNS = "id, name, created_at, token_ciphertext";
const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_TIMEOUT_MS = 15_000;
const NOTION_PAGES = 5;
/** Notion allows about three requests a second per integration (plan 5.6). */
const NOTION_GAP_MS = 334;

export type NotionMethod = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * Saved Notion sources: each keeps its own integration token. Markdown needs no saved source, so a
 * site without one of these is created with the starter's Markdown content. The token is in the source's
 * row, encrypted with the field key (plan 6.9), never in an API response.
 */
export class DataSourceService {
  constructor(
    private readonly opts: {
      db: Db;
      vault: FieldVault;
      /** null in tests and offline mode: listing Notion databases is refused. */
      fetchImpl: typeof fetch | null;
      notionApi?: string;
      /** Least time between two Notion requests with one token; tests pass 0. */
      notionGapMs?: number;
    },
  ) {}

  /** When each token may send its next Notion request (plan 5.6), so requests queue instead of bursting. */
  private readonly nextSlot = new Map<string, number>();

  list(): SavedDataSource[] {
    const rows = this.opts.db
      .prepare(`SELECT ${COLUMNS} FROM data_sources WHERE platform = 'notion' ORDER BY rowid`)
      .all() as Row[];
    return rows.map((row) => this.view(row));
  }

  get(id: string): SavedDataSource {
    return this.view(this.row(id));
  }

  create(req: DataSourceRequest): SavedDataSource {
    this.assertName(req.name);
    const token = req.token?.trim();
    if (!token) throw new SiteError("datasource.no_token", 400);
    const id = newId();
    this.opts.db
      .prepare(
        "INSERT INTO data_sources (id, name, platform, config_json, created_at, token_ciphertext) VALUES (?, ?, 'notion', '{}', ?, ?)",
      )
      .run(id, req.name, new Date().toISOString(), this.opts.vault.seal(token, TABLE, id));
    return this.get(id);
  }

  private readonly tokenListeners = new Set<(id: string) => void>();

  /** Called with the source's id after its token was replaced by another one. */
  onTokenReplaced(listener: (id: string) => void): void {
    this.tokenListeners.add(listener);
  }

  private readonly removeListeners = new Set<(id: string) => void>();

  /** Called with the source's id after it was removed (its content conversations went with it). */
  onRemoved(listener: (id: string) => void): void {
    this.removeListeners.add(listener);
  }

  update(id: string, req: DataSourceRequest): SavedDataSource {
    const row = this.row(id);
    this.assertName(req.name, id);
    // An omitted token keeps the stored one; a null token makes the source unusable, so refuse it.
    const before = this.tokenOf(row);
    const token = req.token === undefined ? before : req.token.trim() || null;
    if (token === null) throw new SiteError("datasource.no_token", 400);
    const sealed = req.token === undefined ? row.token_ciphertext : this.opts.vault.seal(token, TABLE, id);
    this.opts.db
      .prepare("UPDATE data_sources SET name = ?, token_ciphertext = ? WHERE id = ?")
      .run(req.name, sealed, id);
    // Another token may read another workspace: what the old one recorded must go (plan 5.5).
    if (token !== before) for (const listener of this.tokenListeners) listener(id);
    return this.get(id);
  }

  remove(id: string): void {
    this.row(id);
    const used = this.opts.db
      .prepare("SELECT COUNT(*) AS count FROM sites WHERE notion_data_source_id = ?")
      .get(id) as { count: number };
    if (used.count > 0) throw new SiteError("datasource.in_use", 409, { count: String(used.count) });
    this.opts.db.prepare("DELETE FROM data_sources WHERE id = ?").run(id);
    for (const listener of this.removeListeners) listener(id);
  }

  /** The Notion token for a data source, or null. */
  token(id: string): string | null {
    const row = this.opts.db.prepare(`SELECT ${COLUMNS} FROM data_sources WHERE id = ?`).get(id) as Row | undefined;
    return row ? this.tokenOf(row) : null;
  }

  /**
   * Databases the saved Notion token can read. The user must share each database with the integration
   * in Notion first; this is the list the site-creation picker shows for one data source.
   */
  async notionDatabases(id: string): Promise<NotionDatabase[]> {
    const token = this.notionToken(id);

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

  /**
   * One Notion API call with a data source's token, for content management (plan 5.6). A `write` changes
   * content, so its 403 means the integration lacks Insert or Update content.
   */
  async notionCall(
    id: string,
    method: NotionMethod,
    path: string,
    body?: Record<string, unknown>,
    write = false,
  ): Promise<Record<string, unknown>> {
    return this.notion(this.notionToken(id), method, path, body, write ? "write" : "read");
  }

  /** The source's token, once it is known that Notion can be called with it. */
  private notionToken(id: string): string {
    this.get(id);
    const token = this.token(id);
    if (!token) throw new SiteError("datasource.no_token", 409);
    if (!this.opts.fetchImpl) throw new SiteError("datasource.notion_offline", 503);
    return token;
  }

  /** Wait for the token's next free slot. */
  private async throttle(token: string): Promise<void> {
    const gap = this.opts.notionGapMs ?? NOTION_GAP_MS;
    if (gap <= 0) return;
    const now = Date.now();
    const at = Math.max(now, this.nextSlot.get(token) ?? 0);
    this.nextSlot.set(token, at + gap);
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  }

  private row(id: string): Row {
    const row = this.opts.db
      .prepare(`SELECT ${COLUMNS} FROM data_sources WHERE id = ? AND platform = 'notion'`)
      .get(id) as Row | undefined;
    if (!row) throw new SiteError("datasource.not_found", 404);
    return row;
  }

  private assertName(name: string, except = ""): void {
    const row = this.opts.db.prepare("SELECT id FROM data_sources WHERE name = ? AND id <> ?").get(name, except) as
      | { id: string }
      | undefined;
    if (row) throw new SiteError("datasource.name_exists", 409);
  }

  private tokenOf(row: Row): string | null {
    return row.token_ciphertext === null ? null : this.opts.vault.open(row.token_ciphertext, TABLE, row.id);
  }

  private view(row: Row): SavedDataSource {
    const token = this.tokenOf(row);
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
    method: NotionMethod,
    path: string,
    body?: Record<string, unknown>,
    /** Content management's requests (plan 5.6) tell Notion's 400, 403 and 409 apart. */
    content?: "read" | "write",
  ): Promise<Record<string, unknown>> {
    await this.throttle(token);
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
      if (!res?.ok)
        throw content ? await contentError(res, content) : new SiteError(notionFailure(res?.status ?? 0), 503);
      const json: unknown = await res.json();
      return json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    } catch (err) {
      if (err instanceof SiteError) throw err;
      throw new SiteError("datasource.notion_offline", 503);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** A failed Notion response to content management, as the error the UI explains. */
async function contentError(res: Response | undefined, content: "read" | "write"): Promise<SiteError> {
  const status = res?.status ?? 0;
  if (status === 403 && content === "write") return new SiteError("content.notion_write_forbidden", 403);
  if (status === 409) return new SiteError("content.conflict", 409);
  if (status === 400) {
    // Notion's message is not shown (it is English and may quote content); only the case the UI can explain.
    let message = "";
    try {
      const json: unknown = await res?.json();
      if (isRecord(json) && typeof json.message === "string") message = json.message;
    } catch {}
    // API 2022-06-28 cannot read a database that has several data sources (plan 5.6).
    if (/data[ _]sources?/i.test(message)) return new SiteError("content.notion_multi_source", 400);
    return new SiteError("content.notion_rejected", 400);
  }
  return new SiteError(notionFailure(status), 503);
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
