import crypto from "node:crypto";
import { contentKey, type ProjectKey, parseContentKey } from "@bukitjalil/shared";
import { ownerOf, rowProject } from "../projects/owner.ts";
import type { Db } from "../store/db.ts";

export interface SessionRecord {
  id: string;
  project: ProjectKey;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SessionRow {
  id: string;
  site_id: string | null;
  theme_id: string | null;
  data_source_id: string | null;
  database_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

const toRecord = (row: SessionRow): SessionRecord => ({
  id: row.id,
  project:
    row.data_source_id !== null && row.database_id !== null
      ? contentKey({ sourceId: row.data_source_id, databaseId: row.database_id })
      : rowProject(row),
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * The columns that name a session's owner (migration 016): a site, a theme project, or a data source's
 * database for a content key.
 */
function ownerColumns(key: ProjectKey): { columns: string[]; values: string[] } {
  const content = parseContentKey(key);
  if (content) return { columns: ["data_source_id", "database_id"], values: [content.sourceId, content.databaseId] };
  const owner = ownerOf(key);
  return { columns: [owner.column], values: [owner.id] };
}

/** Session ids are URL segments. */
export const newSessionId = () => crypto.randomBytes(8).toString("hex");
export const isSessionId = (id: string) => /^[0-9a-f]{16}$/.test(id);

/**
 * The `sessions` table (plan 4.2) and each session's Pi entries in `session_entries` (plan 6.9). Whether a
 * session is running lives in memory only, so the status column always holds "idle".
 */
export class SessionStore {
  constructor(private readonly db: Db) {}

  /** A new session, with its first entries (a fork's branch) in the same transaction. */
  insert(session: { id: string; project: ProjectKey }, entries: readonly unknown[] = []): SessionRecord {
    const now = new Date().toISOString();
    const owner = ownerColumns(session.project);
    const marks = owner.columns.map(() => "?").join(", ");
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO sessions (id, ${owner.columns.join(", ")}, title, created_at, updated_at, status) VALUES (?, ${marks}, NULL, ?, ?, 'idle')`,
        )
        .run(session.id, ...owner.values, now, now);
      if (entries.length > 0) this.saveEntries(session.id, entries);
    })();
    return { ...session, title: null, createdAt: now, updatedAt: now };
  }

  get(id: string): SessionRecord | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? toRecord(row) : null;
  }

  /** Most recently used first. */
  list(project: ProjectKey): SessionRecord[] {
    const owner = ownerColumns(project);
    const where = owner.columns.map((c) => `${c} = ?`).join(" AND ");
    const rows = this.db
      .prepare(`SELECT * FROM sessions WHERE ${where} ORDER BY updated_at DESC, id`)
      .all(...owner.values) as unknown as SessionRow[];
    return rows.map(toRecord);
  }

  rename(id: string, title: string | null): void {
    this.db
      .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, new Date().toISOString(), id);
  }

  touch(id: string): void {
    this.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  /** Deleting the row deletes its entries (ON DELETE CASCADE). */
  delete(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  /** The session's Pi entries in order, header first; empty before its first message. */
  entries(id: string): unknown[] {
    const rows = this.db
      .prepare("SELECT entry_json FROM session_entries WHERE session_id = ? ORDER BY seq")
      .all(id) as { entry_json: string }[];
    return rows.map((row) => JSON.parse(row.entry_json) as unknown);
  }

  /**
   * Save the session's entries, header first (plan 6.9). Pi only appends, so normally only the new tail is
   * written; if the saved entries are not where they were (another order, another header), all are written
   * again. One transaction either way. Returns the number of entries saved.
   */
  saveEntries(id: string, entries: readonly unknown[]): number {
    const saved = this.db
      .prepare("SELECT seq, entry_id FROM session_entries WHERE session_id = ? ORDER BY seq")
      .all(id) as { seq: number; entry_id: string }[];
    const prefix =
      saved.length <= entries.length && saved.every((row, i) => row.seq === i && row.entry_id === entryId(entries[i]));
    const insert = this.db.prepare(
      "INSERT INTO session_entries (session_id, seq, entry_id, entry_json) VALUES (?, ?, ?, ?)",
    );
    this.db.transaction(() => {
      if (!prefix) this.db.prepare("DELETE FROM session_entries WHERE session_id = ?").run(id);
      for (let i = prefix ? saved.length : 0; i < entries.length; i++) {
        insert.run(id, i, entryId(entries[i]), JSON.stringify(entries[i]));
      }
    })();
    return entries.length;
  }
}

/** Every Pi entry has a string id, the header too (its session id). */
function entryId(entry: unknown): string {
  const id = (entry as { id?: unknown } | null)?.id;
  if (typeof id !== "string") throw new Error("a session entry has no id");
  return id;
}
