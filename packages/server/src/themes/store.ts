import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type ConfigCheck, isProjectId, type SiteReason, type Theme, type ThemeOrigin } from "@bukitjalil/shared";
import type { ProjectState } from "../projects/repo.ts";

interface ThemeRow {
  id: string;
  name: string;
  theme_name: string;
  path: string;
  default_branch: string;
  config_file: string;
  origin: ThemeOrigin;
  created_at: string;
  last_opened_at: string | null;
  archived: number;
  read_only_reasons: string | null;
  checked_commit: string | null;
  config_check: string | null;
}

function toTheme(row: ThemeRow): Theme {
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
    themeName: row.theme_name,
    path: row.path,
    defaultBranch: row.default_branch,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
    archived: row.archived === 1,
    readOnly,
    checkedCommit: row.checked_commit,
    configCheck: row.config_check as ConfigCheck | null,
    configFile: row.config_file,
    origin: row.origin,
  };
}

/** Theme ids are path segments (worktrees/themes/<themeId>/): 16 lower-case hex characters, like site ids. */
export const newThemeId = () => crypto.randomBytes(8).toString("hex");

/** The `themes` table (migration 013, theme development design 3.2). */
export class ThemeStore {
  constructor(private readonly db: DatabaseSync) {}

  list(): Theme[] {
    const rows = this.db
      .prepare("SELECT * FROM themes ORDER BY archived, COALESCE(last_opened_at, created_at) DESC")
      .all();
    return (rows as unknown as ThemeRow[]).map(toTheme);
  }

  get(id: string): Theme | null {
    if (!isProjectId(id)) return null;
    const row = this.db.prepare("SELECT * FROM themes WHERE id = ?").get(id);
    return row ? toTheme(row as unknown as ThemeRow) : null;
  }

  /** A new theme project starts read-only with "not_checked" (the column default) until a check finishes. */
  insert(theme: {
    id: string;
    name: string;
    themeName: string;
    path: string;
    defaultBranch: string;
    configFile: string;
    origin: ThemeOrigin;
  }): void {
    this.db
      .prepare(
        "INSERT INTO themes (id, name, theme_name, path, default_branch, config_file, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        theme.id,
        theme.name,
        theme.themeName,
        theme.path,
        theme.defaultBranch,
        theme.configFile,
        theme.origin,
        new Date().toISOString(),
      );
  }

  setState(id: string, state: ProjectState): void {
    this.db
      .prepare("UPDATE themes SET read_only_reasons = ?, checked_commit = ?, config_check = ? WHERE id = ?")
      .run(state.readOnly ? JSON.stringify(state.readOnly) : null, state.checkedCommit, state.configCheck, id);
  }

  patch(id: string, patch: { name?: string; archived?: boolean }): void {
    if (patch.name !== undefined) this.db.prepare("UPDATE themes SET name = ? WHERE id = ?").run(patch.name, id);
    if (patch.archived !== undefined) {
      this.db.prepare("UPDATE themes SET archived = ? WHERE id = ?").run(patch.archived ? 1 : 0, id);
    }
  }

  touch(id: string): void {
    this.db.prepare("UPDATE themes SET last_opened_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM themes WHERE id = ?").run(id);
  }
}
