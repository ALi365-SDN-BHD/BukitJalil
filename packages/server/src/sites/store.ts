import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ConfigCheck, Site, SiteReason } from "@bukitjalil/shared";

interface SiteRow {
  id: string;
  name: string;
  path: string;
  default_branch: string;
  created_at: string;
  last_opened_at: string | null;
  archived: number;
  read_only_reasons: string | null;
  checked_commit: string | null;
  config_check: string | null;
}

function toSite(row: SiteRow): Site {
  let readOnly: SiteReason[] | null = null;
  if (row.read_only_reasons !== null) {
    try {
      readOnly = JSON.parse(row.read_only_reasons) as SiteReason[];
    } catch {
      readOnly = [{ code: "invalid_site_yaml", detail: "stored state is unreadable" }];
    }
  }
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    defaultBranch: row.default_branch,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
    archived: row.archived === 1,
    readOnly,
    checkedCommit: row.checked_commit,
    configCheck: row.config_check as ConfigCheck | null,
  };
}

export interface SiteState {
  readOnly: SiteReason[] | null;
  checkedCommit: string | null;
  configCheck: ConfigCheck | null;
}

/** Site ids are path segments (worktrees/<siteId>/): 16 lower-case hex characters. */
export const newSiteId = () => crypto.randomBytes(8).toString("hex");
export const isSiteId = (id: string) => /^[0-9a-f]{16}$/.test(id);

/** The `sites` table (plan 4.2). */
export class SiteStore {
  constructor(private readonly db: DatabaseSync) {}

  list(): Site[] {
    const rows = this.db
      .prepare("SELECT * FROM sites ORDER BY archived, COALESCE(last_opened_at, created_at) DESC")
      .all();
    return (rows as unknown as SiteRow[]).map(toSite);
  }

  get(id: string): Site | null {
    const row = this.db.prepare("SELECT * FROM sites WHERE id = ?").get(id);
    return row ? toSite(row as unknown as SiteRow) : null;
  }

  /** A new site starts read-only with "not_checked" (the column default) until a check finishes. */
  insert(site: {
    id: string;
    name: string;
    path: string;
    defaultBranch: string;
    notionDataSourceId?: string | null;
  }): void {
    this.db
      .prepare(
        "INSERT INTO sites (id, name, path, default_branch, created_at, notion_data_source_id) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        site.id,
        site.name,
        site.path,
        site.defaultBranch,
        new Date().toISOString(),
        site.notionDataSourceId ?? null,
      );
  }

  /** The saved Notion data source this site was created with; null for Markdown and imported sites. */
  notionDataSourceId(id: string): string | null {
    const row = this.db.prepare("SELECT notion_data_source_id FROM sites WHERE id = ?").get(id) as
      | { notion_data_source_id: string | null }
      | undefined;
    return row?.notion_data_source_id ?? null;
  }

  /** The saved publishing account this site deploys with, or null. */
  publishAccountId(id: string): string | null {
    const row = this.db.prepare("SELECT publish_account_id FROM sites WHERE id = ?").get(id) as
      | { publish_account_id: string | null }
      | undefined;
    return row?.publish_account_id ?? null;
  }

  setPublishAccountId(id: string, accountId: string | null): void {
    this.db.prepare("UPDATE sites SET publish_account_id = ? WHERE id = ?").run(accountId, id);
  }

  setNotionDataSourceId(id: string, sourceId: string | null): void {
    this.db.prepare("UPDATE sites SET notion_data_source_id = ? WHERE id = ?").run(sourceId, id);
  }

  setState(id: string, state: SiteState) {
    this.db
      .prepare("UPDATE sites SET read_only_reasons = ?, checked_commit = ?, config_check = ? WHERE id = ?")
      .run(state.readOnly ? JSON.stringify(state.readOnly) : null, state.checkedCommit, state.configCheck, id);
  }

  patch(id: string, patch: { name?: string; archived?: boolean }): void {
    if (patch.name !== undefined) this.db.prepare("UPDATE sites SET name = ? WHERE id = ?").run(patch.name, id);
    if (patch.archived !== undefined) {
      this.db.prepare("UPDATE sites SET archived = ? WHERE id = ?").run(patch.archived ? 1 : 0, id);
    }
  }

  touch(id: string): void {
    this.db.prepare("UPDATE sites SET last_opened_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM sites WHERE id = ?").run(id);
  }
}
