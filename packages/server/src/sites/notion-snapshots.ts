import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "../log.ts";
import { isSiteId } from "./store.ts";

/** The formal build a site's Notion offline snapshot comes from (plan 5.5). */
export interface NotionSnapshotRecord {
  commit: string;
  builtAt: string;
}

/** Bukit arguments that read a site's snapshot instead of Notion, with no token and no network. */
export interface OfflineNotion {
  record: NotionSnapshotRecord;
  /** For `config check` and `doctor`. */
  checkArgs: string[];
  /** For `build`: the snapshot, and the media cache of the formal build as Bukit's cache directory. */
  buildArgs: string[];
}

/** What replaces the snapshot directory in output an AI or the build report can show. */
export const SNAPSHOT_MASK = "[notion-snapshot]";

/**
 * Notion offline snapshots (plan 5.5), one per site under notion-snapshots/<siteId>/:
 * - snapshot/: written by Bukit (`--notion-snapshot`) during a formal build with the token; Bukit writes a
 *   staging directory next to it and replaces it only after the whole build succeeded, reusing the bodies
 *   of the previous snapshot;
 * - cache/media/: a copy of the formal build's media cache, the `--cache-dir` of offline builds, so images
 *   need no download and the formal build's own cache is never written by an offline build.
 *
 * Both stay out of every checkout (the AI never reads them: they hold drafts and fields the site does not
 * show), are 0700 / 0600 and kept out of Time Machine. The record (commit, time) is in app.db.
 */
export class NotionSnapshots {
  constructor(
    private readonly opts: {
      db: DatabaseSync;
      root: string;
      logger?: Logger;
      /** Keeps a directory out of backups; tmutil on macOS by default. */
      excludeFromBackup?: (dir: string) => Promise<void>;
    },
  ) {}

  /** Strings to mask in Bukit output shown to the AI or kept in reports. */
  get redact(): Record<string, string> {
    return { [this.opts.root]: SNAPSHOT_MASK };
  }

  get(siteId: string): NotionSnapshotRecord | null {
    const row = this.opts.db.prepare('SELECT "commit", built_at FROM notion_snapshots WHERE site_id = ?').get(siteId) as
      | { commit: string; built_at: string }
      | undefined;
    return row ? { commit: row.commit, builtAt: row.built_at } : null;
  }

  /** `--notion-snapshot` for a formal build with the token; makes the site's directory. */
  recordArgs(siteId: string): string[] {
    privateDir(this.opts.root);
    privateDir(this.siteDir(siteId));
    this.sweep(siteId);
    this.excludeFromBackup(this.opts.root);
    return ["--notion-snapshot", this.snapshotDir(siteId)];
  }

  /**
   * After a formal build that recorded the snapshot succeeded: copy its media cache (`<checkout>/.cache/media`)
   * and note the commit. Without a snapshot from Bukit nothing is recorded.
   */
  recorded(siteId: string, commit: string, checkout: string): void {
    if (!fs.existsSync(path.join(this.snapshotDir(siteId), "manifest.json"))) return;
    const dir = this.siteDir(siteId);
    const media = path.join(checkout, ".cache", "media");
    const next = path.join(dir, `.cache-${crypto.randomBytes(6).toString("hex")}`);
    try {
      privateDir(path.join(next, "media"));
      if (fs.lstatSync(media, { throwIfNoEntry: false })?.isDirectory()) copyPrivate(media, path.join(next, "media"));
      replaceDir(next, this.cacheDir(siteId));
    } finally {
      fs.rmSync(next, { recursive: true, force: true });
    }
    // The formal build's own media cache holds the same images.
    this.excludeFromBackup(path.join(checkout, ".cache"));
    this.opts.db
      .prepare(
        'INSERT INTO notion_snapshots (site_id, "commit", built_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(site_id) DO UPDATE SET "commit" = excluded."commit", built_at = excluded.built_at',
      )
      .run(siteId, commit, new Date().toISOString());
  }

  /** The offline arguments, or null when the site has no snapshot yet (a formal build makes one). */
  offline(siteId: string): OfflineNotion | null {
    const record = this.get(siteId);
    if (!record) return null;
    const snapshot = this.snapshotDir(siteId);
    if (!fs.existsSync(path.join(snapshot, "manifest.json"))) {
      // Deleted from outside: forget it, so the UI asks for a formal build again.
      this.remove(siteId);
      return null;
    }
    this.sweep(siteId);
    privateDir(path.join(this.cacheDir(siteId), "media"));
    const checkArgs = ["--notion-snapshot", snapshot, "--notion-offline"];
    return { record, checkArgs, buildArgs: [...checkArgs, "--cache-dir", this.cacheDir(siteId)] };
  }

  /** Delete the site's snapshot and media cache (unbound source, removed site, no Notion source left). */
  remove(siteId: string): void {
    // The record first: if deleting the files fails, no preview claims data that may be half gone.
    this.opts.db.prepare("DELETE FROM notion_snapshots WHERE site_id = ?").run(siteId);
    fs.rmSync(this.siteDir(siteId), { recursive: true, force: true });
  }

  /** `remove`, for callers that must not fail: a failure is only logged. */
  tryRemove(siteId: string, reason: string): void {
    try {
      this.remove(siteId);
    } catch (err) {
      this.opts.logger?.log("warn", "notion_snapshot.remove_failed", { siteId, reason, error: String(err) });
    }
  }

  /**
   * Remove what interrupted runs left next to the snapshot and the cache: Bukit's transaction copies of the
   * cache directory, and half-made or replaced media copies. Callers hold the site lock, so no run uses them;
   * Bukit's own snapshot staging directories are left to Bukit.
   */
  private sweep(siteId: string): void {
    const dir = this.siteDir(siteId);
    for (const name of fs.readdirSync(dir)) {
      if (name === "snapshot" || name === "cache" || name.startsWith(".snapshot.staging-")) continue;
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  }

  private siteDir(siteId: string): string {
    // Site ids are generated, but a path must never leave the root whatever they hold.
    if (!isSiteId(siteId)) throw new Error("invalid site id");
    return path.join(this.opts.root, siteId);
  }

  private snapshotDir(siteId: string): string {
    return path.join(this.siteDir(siteId), "snapshot");
  }

  private cacheDir(siteId: string): string {
    return path.join(this.siteDir(siteId), "cache");
  }

  /** Never fails the caller: a backup exclusion that does not work is only logged. */
  private excludeFromBackup(dir: string): void {
    const exclude = this.opts.excludeFromBackup ?? tmutilExclude;
    exclude(dir).catch((err) =>
      this.opts.logger?.log("warn", "notion_snapshot.backup_exclusion_failed", { error: String(err) }),
    );
  }
}

/** `tmutil addexclusion` on macOS (sticky: it follows the directory); nothing elsewhere. */
function tmutilExclude(dir: string): Promise<void> {
  if (process.platform !== "darwin") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/tmutil", ["addexclusion", dir], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tmutil exited with ${code}`))));
  });
}

function privateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

/** Copy regular files and directories (never links), cloned where the file system can, as 0600 / 0700. */
function copyPrivate(from: string, to: string): void {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      privateDir(dest);
      copyPrivate(src, dest);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_FICLONE);
      fs.chmodSync(dest, 0o600);
    }
  }
}

/** Put `next` in place of `dest`, which may not exist; the old one is deleted afterwards. */
function replaceDir(next: string, dest: string): void {
  const old = `${dest}.old-${crypto.randomBytes(6).toString("hex")}`;
  const had = fs.existsSync(dest);
  if (had) fs.renameSync(dest, old);
  try {
    fs.renameSync(next, dest);
  } catch (err) {
    if (had) fs.renameSync(old, dest);
    throw err;
  }
  fs.rmSync(old, { recursive: true, force: true });
}
