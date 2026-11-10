import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface SessionRecord {
  id: string;
  siteId: string;
  /** Pi's session file, sessions/<siteId>/<id>.jsonl. */
  file: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SessionRow {
  id: string;
  site_id: string;
  pi_session_file: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

const toRecord = (row: SessionRow): SessionRecord => ({
  id: row.id,
  siteId: row.site_id,
  file: row.pi_session_file,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Session ids are file names (sessions/<siteId>/<id>.jsonl) and URL segments. */
export const newSessionId = () => crypto.randomBytes(8).toString("hex");
export const isSessionId = (id: string) => /^[0-9a-f]{16}$/.test(id);

/**
 * The `sessions` table (plan 4.2), an index of Pi's session files. Whether a session is running lives in
 * memory only, so the status column always holds "idle".
 */
export class SessionStore {
  constructor(private readonly db: DatabaseSync) {}

  insert(session: { id: string; siteId: string; file: string }): SessionRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO sessions (id, site_id, pi_session_file, title, created_at, updated_at, status) VALUES (?, ?, ?, NULL, ?, ?, 'idle')",
      )
      .run(session.id, session.siteId, session.file, now, now);
    return { ...session, title: null, createdAt: now, updatedAt: now };
  }

  get(id: string): SessionRecord | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? toRecord(row) : null;
  }

  /** Most recently used first. */
  list(siteId: string): SessionRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions WHERE site_id = ? ORDER BY updated_at DESC, id")
      .all(siteId) as unknown as SessionRow[];
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

  delete(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }
}
