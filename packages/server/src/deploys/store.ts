import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Deploy, DeployOutcome, DeployReport, DeployStatus, DeployStep } from "@bukitjalil/shared";

interface DeployRow {
  id: string;
  site_id: string;
  commit: string;
  repo: string;
  branch: string;
  url: string | null;
  status: string;
  step: string | null;
  outcome: string | null;
  report_json: string | null;
  started_at: string;
  finished_at: string | null;
}

function toDeploy(row: DeployRow): Deploy {
  let report: DeployReport | null = null;
  if (row.report_json !== null) {
    try {
      report = JSON.parse(row.report_json) as DeployReport;
    } catch {
      report = { steps: [], messages: [], output: "", detail: "stored report is unreadable" };
    }
  }
  return {
    id: row.id,
    siteId: row.site_id,
    commit: row.commit,
    repo: row.repo,
    branch: row.branch,
    url: row.url,
    status: row.status as DeployStatus,
    step: row.step as DeployStep | null,
    outcome: row.outcome as DeployOutcome | null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    report,
  };
}

export const newDeployId = () => `dep_${crypto.randomBytes(8).toString("hex")}`;

/** Publish records (plan 14 M6); the newest KEEP per site are kept. */
export class DeployStore {
  constructor(private readonly db: DatabaseSync) {}

  insert(d: { id: string; siteId: string; commit: string; repo: string; branch: string; url: string | null }): void {
    this.db
      .prepare(
        `INSERT INTO deploys (id, site_id, "commit", repo, branch, url, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`,
      )
      .run(d.id, d.siteId, d.commit, d.repo, d.branch, d.url, new Date().toISOString());
  }

  setStep(id: string, step: DeployStep): void {
    this.db.prepare("UPDATE deploys SET step = ? WHERE id = ? AND status = 'running'").run(step, id);
  }

  finish(id: string, status: Exclude<DeployStatus, "running">, outcome: DeployOutcome, report: DeployReport): void {
    this.db
      .prepare("UPDATE deploys SET status = ?, outcome = ?, report_json = ?, finished_at = ? WHERE id = ?")
      .run(status, outcome, JSON.stringify(report), new Date().toISOString(), id);
  }

  get(id: string): Deploy | null {
    const row = this.db.prepare("SELECT * FROM deploys WHERE id = ?").get(id) as DeployRow | undefined;
    return row ? toDeploy(row) : null;
  }

  list(siteId: string, limit: number): Deploy[] {
    const rows = this.db
      .prepare("SELECT * FROM deploys WHERE site_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?")
      .all(siteId, limit) as unknown as DeployRow[];
    return rows.map(toDeploy);
  }

  /** Forget all but the newest `keep` records of a site. */
  prune(siteId: string, keep: number): void {
    this.db
      .prepare(
        `DELETE FROM deploys WHERE site_id = ? AND status != 'running' AND id NOT IN
           (SELECT id FROM deploys WHERE site_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?)`,
      )
      .run(siteId, siteId, keep);
  }

  /** Publishes still marked running from a previous server process; returns how many were closed. */
  closeInterrupted(): number {
    const report: DeployReport = { steps: [], messages: [], output: "" };
    const result = this.db
      .prepare(
        "UPDATE deploys SET status = 'failed', outcome = 'interrupted', report_json = ?, finished_at = ? WHERE status = 'running'",
      )
      .run(JSON.stringify(report), new Date().toISOString());
    return Number(result.changes);
  }
}
