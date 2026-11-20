import crypto from "node:crypto";
import type { ChangeStatus, ProjectKey } from "@bukitjalil/shared";
import { ownerOf, rowProject } from "../projects/owner.ts";
import type { Db } from "../store/db.ts";

export interface ChangeRecord {
  id: string;
  project: ProjectKey;
  createdBySessionId: string | null;
  baseCommit: string;
  snapshotCommit: string;
  status: ChangeStatus;
  summary: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resultCommit: string | null;
  restoreCommit: string | null;
  /** A conversation took part at some point (kept when it is deleted or the change is rebased). */
  aiJoined: boolean;
  /** The line a user action wrote (a restore, a plugin switch); `summary` is the AI's (plan 7.2). */
  userSummary: string | null;
  /** Files the AI changed after joining a change set that has a `userSummary`. */
  aiPaths: string[];
}

interface ChangeRow {
  id: string;
  site_id: string | null;
  theme_id: string | null;
  created_by_session_id: string | null;
  base_commit: string;
  snapshot_commit: string | null;
  status: ChangeStatus;
  summary: string | null;
  created_at: string;
  resolved_at: string | null;
  result_commit: string | null;
  restore_commit: string | null;
  ai_joined: number;
  user_summary: string | null;
  ai_paths: string | null;
}

const toRecord = (row: ChangeRow): ChangeRecord => ({
  id: row.id,
  project: rowProject(row),
  createdBySessionId: row.created_by_session_id,
  baseCommit: row.base_commit,
  snapshotCommit: row.snapshot_commit ?? row.base_commit,
  status: row.status,
  summary: row.summary,
  createdAt: row.created_at,
  resolvedAt: row.resolved_at,
  resultCommit: row.result_commit,
  restoreCommit: row.restore_commit,
  aiJoined: row.ai_joined !== 0,
  userSummary: row.user_summary,
  aiPaths: parsePaths(row.ai_paths),
});

function parsePaths(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** Change set ids are ref names (refs/bukitjalil/changes/<id>) and URL segments. */
export const newChangeId = () => crypto.randomBytes(8).toString("hex");
export const isChangeId = (id: string) => /^[0-9a-f]{16}$/.test(id);

/** The `change_sets` and `change_set_sessions` tables (plan 4.2). At most one open change set per project. */
export class ChangeStore {
  constructor(private readonly db: Db) {}

  get(id: string): ChangeRecord | null {
    const row = this.db.prepare("SELECT * FROM change_sets WHERE id = ?").get(id) as ChangeRow | undefined;
    return row ? toRecord(row) : null;
  }

  open(project: ProjectKey): ChangeRecord | null {
    const owner = ownerOf(project);
    const row = this.db
      .prepare(`SELECT * FROM change_sets WHERE ${owner.column} = ? AND status = 'open'`)
      .get(owner.id) as ChangeRow | undefined;
    return row ? toRecord(row) : null;
  }

  insert(change: {
    id: string;
    project: ProjectKey;
    sessionId: string | null;
    baseCommit: string;
    /** Defaults to the base (nothing changed yet). */
    snapshotCommit?: string;
    restoreCommit?: string | null;
    userSummary?: string | null;
  }): ChangeRecord {
    const now = new Date().toISOString();
    const owner = ownerOf(change.project);
    this.db
      .prepare(
        `INSERT INTO change_sets (id, ${owner.column}, created_by_session_id, base_commit, snapshot_commit, status, created_at,
           restore_commit, user_summary) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      )
      .run(
        change.id,
        owner.id,
        change.sessionId,
        change.baseCommit,
        change.snapshotCommit ?? change.baseCommit,
        now,
        change.restoreCommit ?? null,
        change.userSummary ?? null,
      );
    return this.get(change.id) as ChangeRecord;
  }

  setSnapshot(id: string, commit: string): void {
    this.db.prepare("UPDATE change_sets SET snapshot_commit = ? WHERE id = ?").run(commit, id);
  }

  setSummary(id: string, summary: string): void {
    this.db.prepare("UPDATE change_sets SET summary = ? WHERE id = ?").run(summary, id);
  }

  setUserSummary(id: string, summary: string): void {
    this.db.prepare("UPDATE change_sets SET user_summary = ? WHERE id = ?").run(summary, id);
  }

  setAiPaths(id: string, paths: readonly string[]): void {
    this.db.prepare("UPDATE change_sets SET ai_paths = ? WHERE id = ?").run(JSON.stringify(paths), id);
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
    this.db.prepare("UPDATE change_sets SET ai_joined = 1 WHERE id = ?").run(id);
  }

  /** How the newest change set the session took part in, other than `exceptId`, ended; null if none. */
  lastJoined(sessionId: string, exceptId: string): Exclude<ChangeStatus, "open"> | null {
    const row = this.db
      .prepare(
        `SELECT cs.status FROM change_set_sessions s JOIN change_sets cs ON cs.id = s.change_set_id
         WHERE s.session_id = ? AND cs.id <> ? ORDER BY s.first_turn_at DESC, s.rowid DESC LIMIT 1`,
      )
      .get(sessionId, exceptId) as { status: ChangeStatus } | undefined;
    return row && row.status !== "open" ? row.status : null;
  }

  sessions(id: string): string[] {
    const rows = this.db
      .prepare("SELECT session_id FROM change_set_sessions WHERE change_set_id = ? ORDER BY first_turn_at, rowid")
      .all(id) as { session_id: string }[];
    return rows.map((r) => r.session_id);
  }
}
