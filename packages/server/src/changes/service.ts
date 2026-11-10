import type { DatabaseSync } from "node:sqlite";
import type { ChangeSet, ChangeView, FileDiff } from "@bukitjalil/shared";
import type { GitRunner } from "../git/run.ts";
import type { Logger } from "../log.ts";
import { SiteError } from "../sites/location.ts";
import type { SiteService } from "../sites/service.ts";
import { changedFiles, fileDiff } from "./diff.ts";
import { type Snapshot, snapshotCheckout } from "./snapshot.ts";
import { type ChangeRecord, ChangeStore, isChangeId, newChangeId } from "./store.ts";

export const changeRef = (id: string) => `refs/bukitjalil/changes/${id}`;

export interface ChangeServiceOptions {
  db: DatabaseSync;
  git: GitRunner;
  sites: SiteService;
  logger: Logger;
}

/**
 * Change sets (plan 7.2). The AI only ever edits the site's ai/ checkout; each change set records the
 * default-branch commit it started from and the latest snapshot of that checkout. A site has at most one
 * open change set, shared by all its sessions.
 *
 * Every method that touches the checkout expects the caller to hold the site lock: an AI run holds it for
 * the whole run, so a snapshot, a check or a build never interleaves with another operation.
 */
export class ChangeService {
  readonly store: ChangeStore;
  private readonly listeners = new Set<(siteId: string) => void>();

  constructor(private readonly opts: ChangeServiceOptions) {
    this.store = new ChangeStore(opts.db);
  }

  /** Called with the site id whenever a site's change set changes (for the event stream). */
  subscribe(listener: (siteId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Before a run (site lock held): the open change set, or a new one. A new one resets the ai/ checkout to
   * the head of the default branch and cleans it (plan 7.2), records that commit as the base and pins it
   * with refs/bukitjalil/changes/<id>. Returns the checkout to run in.
   */
  async begin(siteId: string, sessionId: string): Promise<{ cwd: string; change: ChangeRecord }> {
    const { sites, git } = this.opts;
    const site = sites.get(siteId);
    if (site.readOnly) throw new SiteError("site.read_only", 409);
    let change = this.store.open(siteId);
    let cwd: string;
    if (change) {
      // Keep the files as the last run left them; a checkout that went missing comes back at the snapshot.
      cwd = await sites.aiWorktree(siteId, change.snapshotCommit, { reset: false });
    } else {
      const head = await sites.headOf(site);
      cwd = await sites.aiWorktree(siteId, head, { reset: true });
      const id = newChangeId();
      await git.run(["update-ref", changeRef(id), head], { cwd: site.path });
      change = this.store.insert({ id, siteId, sessionId, baseCommit: head });
    }
    this.store.addSession(change.id, sessionId);
    this.emit(siteId);
    return { cwd, change };
  }

  /**
   * Snapshot the checkout (site lock held): after every run and before every Bukit call. When it belongs
   * to the site's open change set, that change set and its ref move to the new commit.
   */
  async snapshot(siteId: string, cwd: string): Promise<Snapshot> {
    const snap = await snapshotCheckout(this.opts.git, cwd);
    const change = this.store.open(siteId);
    if (change && change.snapshotCommit !== snap.commit) {
      const site = this.opts.sites.get(siteId);
      await this.opts.git.run(["update-ref", changeRef(change.id), snap.commit], { cwd: site.path });
      this.store.setSnapshot(change.id, snap.commit);
      this.emit(siteId);
    }
    return snap;
  }

  /** Tell listeners the site's change set may look different (e.g. a run ended, so it can be reviewed). */
  notify(siteId: string): void {
    if (this.store.open(siteId)) this.emit(siteId);
  }

  /** The AI's summary (summarize_changes) goes to the site's open change set. */
  setSummary(siteId: string, summary: string): void {
    const change = this.store.open(siteId);
    if (!change) return;
    this.store.setSummary(change.id, summary);
    this.emit(siteId);
  }

  get(id: string): ChangeRecord {
    const change = isChangeId(id) ? this.store.get(id) : null;
    if (!change) throw new SiteError("change.not_found", 404);
    return change;
  }

  /** The site's open change set with its files, or null; `running` says whether a session is running. */
  async current(siteId: string, running: boolean): Promise<ChangeView | null> {
    const site = this.opts.sites.get(siteId);
    const change = this.store.open(siteId);
    if (!change) return null;
    const { git } = this.opts;
    const [info, { files, truncated }, baseTree] = await Promise.all([
      this.toChangeSet(change),
      changedFiles(git, site.path, change.baseCommit, change.snapshotCommit),
      this.treeOf(site.path, change.baseCommit),
    ]);
    return {
      ...info,
      files,
      filesTruncated: truncated,
      reviewable: !running && info.treeHash !== baseTree,
    };
  }

  /** One file's diff in a change set; 404 when the file is not part of it. */
  async diff(id: string, file: string): Promise<FileDiff> {
    const change = this.get(id);
    const site = this.opts.sites.get(change.siteId);
    const { git } = this.opts;
    // Look only at this path, so files past the list's cap can be diffed too.
    const { files } = await changedFiles(git, site.path, change.baseCommit, change.snapshotCommit, { path: file });
    const entry = files.find((f) => f.path === file);
    if (!entry) throw new SiteError("change.file_not_found", 404);
    return fileDiff(git, site.path, change.baseCommit, change.snapshotCommit, entry);
  }

  async toChangeSet(change: ChangeRecord): Promise<ChangeSet> {
    const site = this.opts.sites.get(change.siteId);
    return {
      id: change.id,
      siteId: change.siteId,
      status: change.status,
      baseCommit: change.baseCommit,
      snapshotCommit: change.snapshotCommit,
      treeHash: await this.treeOf(site.path, change.snapshotCommit),
      summary: change.summary,
      sessionIds: this.store.sessions(change.id),
      createdAt: change.createdAt,
      resolvedAt: change.resolvedAt,
      resultCommit: change.resultCommit,
    };
  }

  private async treeOf(cwd: string, commit: string): Promise<string> {
    return (
      await this.opts.git.text(["rev-parse", "--verify", "--end-of-options", `${commit}^{tree}`], { cwd })
    ).trim();
  }

  private emit(siteId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(siteId);
      } catch (err) {
        this.opts.logger.log("error", "changes.listener_failed", { error: String(err) });
      }
    }
  }
}
