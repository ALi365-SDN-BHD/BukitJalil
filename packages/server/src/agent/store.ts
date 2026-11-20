import crypto from "node:crypto";
import type { ProjectKey } from "@bukitjalil/shared";
import { ownerOf, rowProject } from "../projects/owner.ts";
import type { Db } from "../store/db.ts";

export interface SessionRecord {
  id: string;
  project: ProjectKey;
  /** Pi's session file, sessions/<project>/<id>.jsonl. */
  file: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SessionRow {
  id: string;
  site_id: string | null;
  theme_id: string | null;
  pi_session_file: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

const toRecord = (row: SessionRow): SessionRecord => ({
  id: row.id,
  project: rowProject(row),
  file: row.pi_session_file,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Session ids are file names (sessions/<project>/<id>.jsonl) and URL segments. */
export const newSessionId = () => crypto.randomBytes(8).toString("hex");
export const isSessionId = (id: string) => /^[0-9a-f]{16}$/.test(id);

/**
 * The `sessions` table (plan 4.2), an index of Pi's session files. Whether a session is running lives in
 * memory only, so the status column always holds "idle".
 */
export class SessionStore {
  constructor(private readonly db: Db) {}

  insert(session: { id: string; project: ProjectKey; file: string }): SessionRecord {
    const now = new Date().toISOString();
    const owner = ownerOf(session.project);
    this.db
      .prepare(
        `INSERT INTO sessions (id, ${owner.column}, pi_session_file, title, created_at, updated_at, status) VALUES (?, ?, ?, NULL, ?, ?, 'idle')`,
      )
      .run(session.id, owner.id, session.file, now, now);
    return { ...session, title: null, createdAt: now, updatedAt: now };
  }

  get(id: string): SessionRecord | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? toRecord(row) : null;
  }

  /** Most recently used first. */
  list(project: ProjectKey): SessionRecord[] {
    const owner = ownerOf(project);
    const rows = this.db
      .prepare(`SELECT * FROM sessions WHERE ${owner.column} = ? ORDER BY updated_at DESC, id`)
      .all(owner.id) as unknown as SessionRow[];
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
