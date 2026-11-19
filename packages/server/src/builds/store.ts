import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Build, BuildOutcome, BuildReport, BuildStatus, ProjectKey } from "@bukitjalil/shared";
import { ownerOf, rowProject } from "../projects/owner.ts";

interface BuildRow {
  id: string;
  site_id: string | null;
  theme_id: string | null;
  change_set_id: string | null;
  commit: string;
  status: string;
  exit_code: number | null;
  output_dir: string | null;
  report_json: string | null;
  started_at: string;
  finished_at: string | null;
}

/** report_json holds the outcome next to the report, so the table needs no new column. */
interface StoredReport extends BuildReport {
  outcome: BuildOutcome;
}

export interface BuildRecord extends Build {
  /** previews/<project>/<buildId>, while the output is kept. */
  outputDir: string | null;
  /** The change set a change build previews; null for main builds. */
  changeSetId: string | null;
}

function toBuild(row: BuildRow): BuildRecord {
  let stored: StoredReport | null = null;
  if (row.report_json !== null) {
    try {
      stored = JSON.parse(row.report_json) as StoredReport;
    } catch {
      stored = { outcome: "error", messages: [], output: "", detail: "stored report is unreadable" };
    }
  }
  const { outcome = null, ...report } = stored ?? {};
  return {
    id: row.id,
    project: rowProject(row),
    ref: row.change_set_id === null ? "main" : "change",
    commit: row.commit,
    status: row.status as BuildStatus,
    outcome,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    hasOutput: row.output_dir !== null,
    report: stored ? (report as BuildReport) : null,
    outputDir: row.output_dir,
    changeSetId: row.change_set_id,
  };
}

/** Build ids are path segments (previews/<project>/<buildId>/, .bukitjalil-build/<buildId>/). */
export const newBuildId = () => crypto.randomBytes(8).toString("hex");

/** The `builds` table (plan 4.2), `kind = 'build'` rows only; check and doctor runs are not recorded yet. */
export class BuildStore {
  constructor(private readonly db: DatabaseSync) {}

  insert(build: { id: string; project: ProjectKey; commit: string; changeSetId?: string | null }): void {
    const owner = ownerOf(build.project);
    this.db
      .prepare(
        `INSERT INTO builds (id, ${owner.column}, change_set_id, "commit", kind, status, started_at) VALUES (?, ?, ?, ?, 'build', 'running', ?)`,
      )
      .run(build.id, owner.id, build.changeSetId ?? null, build.commit, new Date().toISOString());
  }

  finish(
    id: string,
    result: { status: Exclude<BuildStatus, "running">; outcome: BuildOutcome; exitCode: number | null },
    report: BuildReport,
    outputDir: string | null,
  ): void {
    const stored: StoredReport = { outcome: result.outcome, ...report };
    this.db
      .prepare(
        "UPDATE builds SET status = ?, exit_code = ?, output_dir = ?, report_json = ?, finished_at = ? WHERE id = ?",
      )
      .run(result.status, result.exitCode, outputDir, JSON.stringify(stored), new Date().toISOString(), id);
  }

  get(id: string): BuildRecord | null {
    const row = this.db.prepare("SELECT * FROM builds WHERE id = ? AND kind = 'build'").get(id);
    return row ? toBuild(row as unknown as BuildRow) : null;
  }

  /** Newest first. */
  list(project: ProjectKey, limit: number): BuildRecord[] {
    const owner = ownerOf(project);
    const rows = this.db
      .prepare(
        `SELECT * FROM builds WHERE ${owner.column} = ? AND kind = 'build' ORDER BY started_at DESC, rowid DESC LIMIT ?`,
      )
      .all(owner.id, limit);
    return (rows as unknown as BuildRow[]).map(toBuild);
  }

  /** The newest build of `ref` whose output is kept: what that preview shows. */
  latestWithOutput(project: ProjectKey, ref: "main" | "change"): BuildRecord | null {
    const owner = ownerOf(project);
    const row = this.db
      .prepare(
        `SELECT * FROM builds WHERE ${owner.column} = ? AND kind = 'build' AND output_dir IS NOT NULL
           AND (change_set_id IS NULL) = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`,
      )
      .get(owner.id, ref === "main" ? 1 : 0);
    return row ? toBuild(row as unknown as BuildRow) : null;
  }

  /**
   * The newest finished builds of one ref, newest first (plan 10.4): main builds when `changeSetId` is
   * null, else that change set's. Its own window, so many change builds never hide the main ones.
   */
  finishedOf(project: ProjectKey, changeSetId: string | null, limit: number): BuildRecord[] {
    const owner = ownerOf(project);
    const rows = this.db
      .prepare(
        `SELECT * FROM builds WHERE ${owner.column} = ? AND kind = 'build' AND status != 'running'
           AND change_set_id IS ? ORDER BY started_at DESC, rowid DESC LIMIT ?`,
      )
      .all(owner.id, changeSetId, limit);
    return (rows as unknown as BuildRow[]).map(toBuild);
  }

  /** Builds with a kept output, newest first. */
  withOutput(project: ProjectKey): BuildRecord[] {
    const owner = ownerOf(project);
    const rows = this.db
      .prepare(
        `SELECT * FROM builds WHERE ${owner.column} = ? AND kind = 'build' AND output_dir IS NOT NULL ORDER BY started_at DESC, rowid DESC`,
      )
      .all(owner.id);
    return (rows as unknown as BuildRow[]).map(toBuild);
  }

  dropOutput(id: string): void {
    this.db.prepare("UPDATE builds SET output_dir = NULL WHERE id = ?").run(id);
  }

  /** Keep the newest `keep` records of a project; older ones go (their outputs are already gone). */
  pruneRecords(project: ProjectKey, keep: number): void {
    const { column, id } = ownerOf(project);
    this.db
      .prepare(
        `DELETE FROM builds WHERE ${column} = ? AND kind = 'build' AND output_dir IS NULL AND status != 'running'
           AND id NOT IN (SELECT id FROM builds WHERE ${column} = ? AND kind = 'build'
                          ORDER BY started_at DESC, rowid DESC LIMIT ?)`,
      )
      .run(id, id, keep);
  }

  /** Builds still marked running from a previous server process; returns how many were closed. */
  closeInterrupted(): number {
    const report: StoredReport = { outcome: "interrupted", messages: [], output: "" };
    const result = this.db
      .prepare("UPDATE builds SET status = 'failed', report_json = ?, finished_at = ? WHERE status = 'running'")
      .run(JSON.stringify(report), new Date().toISOString());
    return Number(result.changes);
  }
}
