import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ChangeStatus } from "@bukitjalil/shared";

export interface ChangeRecord {
  id: string;
  siteId: string;
  createdBySessionId: string | null;
  baseCommit: string;
  snapshotCommit: string;
  status: ChangeStatus;
  summary: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resultCommit: string | null;
  restoreCommit: string | null;
}

interface ChangeRow {
  id: string;
  site_id: string;
  created_by_session_id: string | null;
  base_commit: string;
  snapshot_commit: string | null;
  status: ChangeStatus;
  summary: string | null;
  created_at: string;
  resolved_at: string | null;
  result_commit: string | null;
  restore_commit: string | null;
}

const toRecord = (row: ChangeRow): ChangeRecord => ({
  id: row.id,
  siteId: row.site_id,
  createdBySessionId: row.created_by_session_id,
  baseCommit: row.base_commit,
  snapshotCommit: row.snapshot_commit ?? row.base_commit,
  status: row.status,
  summary: row.summary,
  createdAt: row.created_at,
  resolvedAt: row.resolved_at,
  resultCommit: row.result_commit,
  restoreCommit: row.restore_commit,
});

/** Change set ids are ref names (refs/bukitjalil/changes/<id>) and URL segments. */
export const newChangeId = () => crypto.randomBytes(8).toString("hex");
export const isChangeId = (id: string) => /^[0-9a-f]{16}$/.test(id);

/** The `change_sets` and `change_set_sessions` tables (plan 4.2). At most one open change set per site. */
export class ChangeStore {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): ChangeRecord | null {
    const row = this.db.prepare("SELECT * FROM change_sets WHERE id = ?").get(id) as ChangeRow | undefined;
    return row ? toRecord(row) : null;
  }

  open(siteId: string): ChangeRecord | null {
    const row = this.db.prepare("SELECT * FROM change_sets WHERE site_id = ? AND status = 'open'").get(siteId) as
      | ChangeRow
      | undefined;
    return row ? toRecord(row) : null;
  }

  insert(change: {
    id: string;
    siteId: string;
    sessionId: string | null;
    baseCommit: string;
    /** Defaults to the base (nothing changed yet). */
    snapshotCommit?: string;
    restoreCommit?: string | null;
    summary?: string | null;
  }): ChangeRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO change_sets (id, site_id, created_by_session_id, base_commit, snapshot_commit, status, created_at,
           restore_commit, summary) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      )
      .run(
        change.id,
        change.siteId,
        change.sessionId,
        change.baseCommit,
        change.snapshotCommit ?? change.baseCommit,
        now,
        change.restoreCommit ?? null,
        change.summary ?? null,
      );
    return this.get(change.id) as ChangeRecord;
  }

  setSnapshot(id: string, commit: string): void {
    this.db.prepare("UPDATE change_sets SET snapshot_commit = ? WHERE id = ?").run(commit, id);
  }

  setSummary(id: string, summary: string): void {
    this.db.prepare("UPDATE change_sets SET summary = ? WHERE id = ?").run(summary, id);
  }

  /** Close the change set: applied (with the commit it became), rejected or stale. */
  resolve(id: string, status: Exclude<ChangeStatus, "open">, resultCommit: string | null = null): void {
    this.db
      .prepare("UPDATE change_sets SET status = ?, resolved_at = ?, result_commit = ? WHERE id = ? AND status = 'open'")
      .run(status, new Date().toISOString(), resultCommit, id);
  }

  /** The default branch moved and the change was merged onto it: new base and snapshot. */
  rebase(id: string, baseCommit: string, snapshotCommit: string): void {
    this.db
      .prepare("UPDATE change_sets SET base_commit = ?, snapshot_commit = ? WHERE id = ?")
      .run(baseCommit, snapshotCommit, id);
  }

  /** Record that a session took part (the first time only). */
  addSession(id: string, sessionId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO change_set_sessions (change_set_id, session_id, first_turn_at) VALUES (?, ?, ?)")
      .run(id, sessionId, new Date().toISOString());
  }

  sessions(id: string): string[] {
    const rows = this.db
      .prepare("SELECT session_id FROM change_set_sessions WHERE change_set_id = ? ORDER BY first_turn_at, rowid")
      .all(id) as { session_id: string }[];
    return rows.map((r) => r.session_id);
  }
}
