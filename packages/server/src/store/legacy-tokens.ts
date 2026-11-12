import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isRecord } from "../bukit/guard.ts";
import type { DataSourceService } from "../data-sources/service.ts";
import { deployTarget } from "../deploys/target.ts";
import type { Logger } from "../log.ts";
import type { PanelService } from "../panels/service.ts";
import type { AppPaths } from "../paths.ts";
import type { PublishAccountService } from "../publish/accounts.ts";
import type { SiteService } from "../sites/service.ts";
import { JsonFile } from "./json-file.ts";

const ACCOUNT_NAME = "Imported GitHub account";
const SOURCE_NAME = "Imported Notion source";
const MAX_OLD_FILE = 64 * 1024;
/** The old SecretStore's temporary name: `.secrets-<12 hex>.tmp`. */
const LEGACY_TEMP = /^\.secrets-[0-9a-f]{12}\.tmp$/;

type LegacyTokenKind = "github" | "notion";
type LegacyImportStatus = "imported" | "adopted";

interface LegacyImportState {
  kind: LegacyTokenKind;
  rowId: string | null;
  status: LegacyImportStatus;
}

/** The fields the migration needs from a publishing account or data source. */
interface ImportRow {
  id: string;
  name: string;
  hasToken: boolean;
}

type ImportPlan =
  | { action: "create"; token: string; status: "imported" }
  | { action: "fill"; rowId: string; token: string; status: "imported" }
  | { action: "adopt"; rowId: string; status: "adopted" }
  | { action: "backfill"; rowId: string; hasToken: boolean; status: "adopted" }
  | { action: "retry"; rowId: string; hasToken: boolean }
  | { action: "skip"; reason: string }
  | { action: "missing" }
  | { action: "none" };

/** Remove temporary files left by the old SecretStore when a write was killed before its rename. */
export function cleanupLegacyTempFiles(dir: string): number {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!LEGACY_TEMP.test(name)) continue;
    const file = path.join(dir, name);
    try {
      if (!fs.lstatSync(file).isFile()) continue;
      fs.rmSync(file, { force: true });
      removed++;
    } catch {
      // A file that disappears or cannot be removed is not worth failing startup for.
    }
  }
  return removed;
}

export interface LegacyTokenOptions {
  db: DatabaseSync;
  paths: AppPaths;
  sites: SiteService;
  panels: Pick<PanelService, "config">;
  publishAccounts: PublishAccountService;
  dataSources: DataSourceService;
  logger: Logger;
  /** Values captured from the environment before `main.ts` removed them. */
  env?: { github?: string | null; notion?: string | null };
  /** Test seam: called just before COMMIT; throw to simulate a failed migration. */
  beforeCommit?: () => void;
}

export interface LegacyTokenResult {
  accounts: number;
  sources: number;
  linkedSites: number;
  skippedSites: number;
}

/**
 * Move the old global GitHub/Notion tokens into the first saved account/source and link the sites that
 * use them. The fixed names are only a compatibility aid: once a kind is recorded in
 * `legacy_token_imports`, its row id is the identity, so renaming or deleting the row cannot make the
 * environment token import itself again. The old `secrets.json` is removed only after the database work
 * succeeds and the imported row still has its token.
 */
export async function migrateLegacyTokens(opts: LegacyTokenOptions): Promise<LegacyTokenResult> {
  let oldExists = false;
  try {
    oldExists = Boolean(fs.lstatSync(opts.paths.secrets, { throwIfNoEntry: false }));
  } catch (err) {
    opts.logger.log("warn", "tokens.migration_unreadable", { reason: String(err) });
  }
  let oldReadable = false;
  let old: Record<string, unknown> = {};
  if (oldExists) {
    try {
      const value = new JsonFile(opts.paths.secrets, { maxBytes: MAX_OLD_FILE }).read();
      if (isRecord(value)) {
        old = value;
        oldReadable = true;
      } else if (value !== undefined) {
        opts.logger.log("warn", "tokens.migration_unreadable", { reason: "not an object" });
      }
    } catch (err) {
      opts.logger.log("warn", "tokens.migration_unreadable", { reason: String(err) });
    }
  }

  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  const github = text(opts.env?.github) ?? text(old.github);
  const notion = text(opts.env?.notion) ?? text(old.notion);

  const accounts = opts.publishAccounts.list();
  const sources = opts.dataSources.list();
  const githubPlan = planImport(github, accounts, readImportState(opts.db, "github"), ACCOUNT_NAME);
  const notionPlan = planImport(notion, sources, readImportState(opts.db, "notion"), SOURCE_NAME);
  logPlan(githubPlan, "github", opts.logger);
  logPlan(notionPlan, "notion", opts.logger);

  const linkGithub = planLinks(githubPlan);
  const linkNotion = planLinks(notionPlan);
  const publishSites: string[] = [];
  const notionSites: string[] = [];
  let skippedSites = 0;
  if (linkGithub || linkNotion) {
    for (const site of opts.sites.list()) {
      const needsGithub = linkGithub && opts.sites.publishAccountId(site.id) === null;
      const needsNotion = linkNotion && opts.sites.notionDataSourceId(site.id) === null;
      if (!needsGithub && !needsNotion) continue;
      if (site.readOnly) {
        skippedSites++;
        continue;
      }
      try {
        const { config } = await opts.panels.config(site.id, "main");
        if (!isRecord(config)) {
          skippedSites++;
          continue;
        }
        if (needsGithub) {
          const target = deployTarget(config);
          // The deploy service also refuses a publish branch equal to the site's source branch.
          if (target.problem === null && target.repo !== null && target.branch !== site.defaultBranch) {
            publishSites.push(site.id);
          }
        }
        if (needsNotion && usesNotion(config)) {
          notionSites.push(site.id);
        }
      } catch {
        skippedSites++;
      }
    }
  }

  let accountId = planRowId(githubPlan);
  let sourceId = planRowId(notionPlan);
  const writtenAccounts = new Set<string>();
  const writtenSources = new Set<string>();
  const linked = new Set<string>();
  opts.db.exec("BEGIN");
  try {
    if (githubPlan.action === "create") {
      accountId = opts.publishAccounts.create({ name: ACCOUNT_NAME, platform: "github", token: githubPlan.token }).id;
      writtenAccounts.add(accountId);
    } else if (githubPlan.action === "fill") {
      accountId = githubPlan.rowId;
      // Add before writing: if the write succeeds and a later step fails, rollback removes it again.
      writtenAccounts.add(accountId);
      opts.publishAccounts.adoptToken(accountId, githubPlan.token);
    }
    const githubStatus = planStatus(githubPlan);
    if (githubStatus !== null && accountId !== null) {
      writeImportState(opts.db, "github", accountId, githubStatus);
    }

    if (notionPlan.action === "create") {
      sourceId = opts.dataSources.create({ name: SOURCE_NAME, platform: "notion", token: notionPlan.token }).id;
      writtenSources.add(sourceId);
    } else if (notionPlan.action === "fill") {
      sourceId = notionPlan.rowId;
      writtenSources.add(sourceId);
      opts.dataSources.adoptToken(sourceId, notionPlan.token);
    }
    const notionStatus = planStatus(notionPlan);
    if (notionStatus !== null && sourceId !== null) {
      writeImportState(opts.db, "notion", sourceId, notionStatus);
    }

    if (accountId !== null && planLinks(githubPlan)) {
      for (const siteId of publishSites) {
        opts.sites.setPublishAccountId(siteId, accountId);
        linked.add(siteId);
      }
    }
    if (sourceId !== null && planLinks(notionPlan)) {
      for (const siteId of notionSites) {
        opts.sites.setNotionDataSourceId(siteId, sourceId);
        linked.add(siteId);
      }
    }
    opts.beforeCommit?.();
    opts.db.exec("COMMIT");
  } catch (err) {
    try {
      opts.db.exec("ROLLBACK");
    } catch {
      // SQLite may have ended the transaction itself; the create error is the useful one.
    }
    for (const id of writtenAccounts) {
      try {
        opts.publishAccounts.discardToken(id);
      } catch {
        // The migration error is the useful one; the old file is kept below.
      }
    }
    for (const id of writtenSources) {
      try {
        opts.dataSources.discardToken(id);
      } catch {
        // Same.
      }
    }
    throw err;
  }

  const accountsNow = opts.publishAccounts.list();
  const sourcesNow = opts.dataSources.list();
  const githubHandled = tokenHandled(github, accountId, accountsNow);
  const notionHandled = tokenHandled(notion, sourceId, sourcesNow);

  let oldFileRemoved = false;
  if (oldExists && oldReadable && githubHandled && notionHandled) {
    try {
      fs.rmSync(opts.paths.secrets, { force: true });
      oldFileRemoved = true;
    } catch (err) {
      opts.logger.log("warn", "tokens.migration_remove_failed", { reason: String(err) });
    }
  }

  const result: LegacyTokenResult = {
    accounts: githubPlan.action === "create" ? 1 : 0,
    sources: notionPlan.action === "create" ? 1 : 0,
    linkedSites: linked.size,
    skippedSites,
  };
  opts.logger.log("info", "tokens.migrated", {
    accounts: result.accounts,
    sources: result.sources,
    linkedSites: result.linkedSites,
    skippedSites: result.skippedSites,
    oldFileRemoved,
  });
  return result;
}

/**
 * Decide what to do for one token kind. With a recorded state, the row id is the identity and the
 * environment/file token is never imported again. Without one, an existing row wins: the only row is
 * filled (if tokenless) or adopted, or a uniquely named imported row is adopted. Multiple unrelated rows
 * are left alone and the old file is kept.
 */
function planImport(
  token: string | null,
  rows: readonly ImportRow[],
  state: LegacyImportState | null,
  importedName: string,
): ImportPlan {
  if (state) {
    if (state.rowId === null) return { action: "missing" };
    const row = rows.find((entry) => entry.id === state.rowId);
    return row ? { action: "retry", rowId: row.id, hasToken: row.hasToken } : { action: "missing" };
  }

  const named = rows.find((entry) => entry.name.toLowerCase() === importedName.toLowerCase());
  if (token === null) {
    // Backfill the identity of a usable row imported by the previous name-based version. A tokenless
    // row stays unrecorded so a later environment token can still fill it.
    const target = named ?? (rows.length === 1 ? rows[0] : undefined);
    return target?.hasToken
      ? { action: "backfill", rowId: target.id, hasToken: true, status: "adopted" }
      : { action: "none" };
  }
  if (rows.length === 0) return { action: "create", token, status: "imported" };
  if (rows.length === 1) {
    const row = rows[0] as ImportRow;
    return row.hasToken
      ? { action: "adopt", rowId: row.id, status: "adopted" }
      : { action: "fill", rowId: row.id, token, status: "imported" };
  }
  if (named) {
    return named.hasToken
      ? { action: "adopt", rowId: named.id, status: "adopted" }
      : { action: "fill", rowId: named.id, token, status: "imported" };
  }
  return { action: "skip", reason: "multiple existing rows" };
}

function readImportState(db: DatabaseSync, kind: LegacyTokenKind): LegacyImportState | null {
  const row = db.prepare("SELECT kind, row_id, status FROM legacy_token_imports WHERE kind = ?").get(kind) as
    | { kind: string; row_id: string | null; status: string }
    | undefined;
  if (!row) return null;
  return { kind, rowId: row.row_id, status: row.status as LegacyImportStatus };
}

function writeImportState(db: DatabaseSync, kind: LegacyTokenKind, rowId: string, status: LegacyImportStatus): void {
  db.prepare("INSERT INTO legacy_token_imports (kind, row_id, status, updated_at) VALUES (?, ?, ?, ?)").run(
    kind,
    rowId,
    status,
    new Date().toISOString(),
  );
}

function planRowId(plan: ImportPlan): string | null {
  switch (plan.action) {
    case "fill":
    case "adopt":
    case "backfill":
    case "retry":
      return plan.rowId;
    default:
      return null;
  }
}

function planLinks(plan: ImportPlan): boolean {
  switch (plan.action) {
    case "create":
    case "fill":
    case "adopt":
      return true;
    case "backfill":
    case "retry":
      return plan.hasToken;
    default:
      return false;
  }
}

function planStatus(plan: ImportPlan): LegacyImportStatus | null {
  switch (plan.action) {
    case "create":
    case "fill":
      return plan.status;
    case "adopt":
    case "backfill":
      return plan.status;
    default:
      return null;
  }
}

function logPlan(plan: ImportPlan, kind: LegacyTokenKind, logger: Logger): void {
  if (plan.action === "missing") {
    logger.log("warn", "tokens.imported_row_missing", { kind });
  } else if ((plan.action === "retry" || plan.action === "backfill") && !plan.hasToken) {
    logger.log("warn", "tokens.imported_row_has_no_token", { kind });
  } else if (plan.action === "skip") {
    logger.log("warn", "tokens.migration_skipped", { kind, reason: plan.reason });
  }
}

function tokenHandled(token: string | null, rowId: string | null, rows: readonly ImportRow[]): boolean {
  if (token === null) return true;
  return rowId !== null && rows.some((row) => row.id === rowId && row.hasToken);
}

function usesNotion(config: Record<string, unknown>): boolean {
  const content = isRecord(config.content) ? config.content : {};
  const sources = Array.isArray(content.sources) ? content.sources : [];
  return sources.some((source) => isRecord(source) && source.type === "notion");
}
