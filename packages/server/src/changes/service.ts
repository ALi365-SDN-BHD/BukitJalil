import type { DatabaseSync } from "node:sqlite";
import type { ApplyCheck, ApplyRequest, ApplyResult, ChangeSet, ChangeView, FileDiff, Site } from "@bukitjalil/shared";
import { GitError, type GitRunner } from "../git/run.ts";
import type { Logger } from "../log.ts";
import { SiteError } from "../sites/location.ts";
import type { SiteLocks } from "../sites/locks.ts";
import type { SiteService } from "../sites/service.ts";
import { changedFiles, fileDiff } from "./diff.ts";
import { SNAPSHOT_IDENTITY, type Snapshot, snapshotCheckout } from "./snapshot.ts";
import { type ChangeRecord, ChangeStore, isChangeId, newChangeId } from "./store.ts";

export const changeRef = (id: string) => `refs/bukitjalil/changes/${id}`;

/** Author of applied AI changes; the committer is the identity from the settings (plan 7.2). */
const AI_AUTHOR = { "author.name": "BukitJalil AI", "author.email": "ai@bukitjalil.local" };
const DEFAULT_MESSAGE = "Changes made with BukitJalil AI";

export interface ChangeServiceOptions {
  db: DatabaseSync;
  git: GitRunner;
  sites: SiteService;
  locks: SiteLocks;
  /** The check before applying: Bukit on the AI checkout (AiBukit.checkForApply), with the site lock held. */
  check: (siteId: string, cwd: string) => Promise<ApplyCheck>;
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

  /**
   * Apply a change set (plan 7.2), under the site lock: snapshot the checkout again and compare it with the
   * fingerprint the user reviewed; if the default branch moved since the base, merge onto it and ask for
   * another review (or close the change set as stale on conflicts); run the check; commit the snapshot's
   * tree on the default branch (author BukitJalil AI, committer from the settings) and fast-forward the
   * site folder to it, refusing to overwrite ignored local files.
   */
  async apply(id: string, req: ApplyRequest): Promise<ApplyResult> {
    const { siteId } = this.get(id);
    return this.opts.locks.run(siteId, "apply", async () => {
      const { git, sites } = this.opts;
      const open = this.openChange(id);
      const site = sites.get(siteId);
      if (site.readOnly) throw new SiteError("site.read_only", 409);
      const identity = sites.commitIdentity();
      const cwd = await sites.aiWorktree(siteId, open.snapshotCommit, { reset: false });
      // The checkout can only differ from the snapshot if something touched it outside a run.
      await this.snapshot(siteId, cwd);
      let change = this.openChange(id);
      const tree = await this.treeOf(site.path, change.snapshotCommit);
      if (tree !== req.treeHash) throw new SiteError("change.fingerprint_mismatch", 409);
      if (tree === (await this.treeOf(site.path, change.baseCommit))) throw new SiteError("change.no_changes", 409);
      await this.assertSiteReady(site);

      const main = await sites.headOf(site);
      if (main !== change.baseCommit) {
        const merged = await this.mergeTree(site.path, main, change.snapshotCommit);
        // On conflicts, or when the default branch already has all of it, there is nothing to review again.
        if (merged === null || merged === (await this.treeOf(site.path, main))) {
          this.close(change, "stale");
          return { outcome: "stale", change: await this.toChangeSet(this.get(id)), check: null };
        }
        const commit = (
          await git.text(["commit-tree", merged, "-p", main, "-m", "BukitJalil AI snapshot (merged)"], {
            cwd: site.path,
            config: SNAPSHOT_IDENTITY,
          })
        ).trim();
        // A full OID from commit-tree (`reset` rejects --end-of-options before it).
        await git.run(["reset", "-q", "--hard", commit], { cwd });
        await git.run(["update-ref", changeRef(change.id), commit], { cwd: site.path });
        this.store.rebase(change.id, main, commit);
        this.emit(siteId);
        return { outcome: "rebased", change: await this.toChangeSet(this.get(id)), check: null };
      }

      const check = await this.opts.check(siteId, cwd);
      // The check snapshots too; it must still be what the user reviewed.
      change = this.openChange(id);
      if ((await this.treeOf(site.path, change.snapshotCommit)) !== req.treeHash) {
        throw new SiteError("change.fingerprint_mismatch", 409);
      }
      if (!check.passed && !req.force)
        return { outcome: "check_failed", change: await this.toChangeSet(change), check };

      const result = (
        await git.text(["commit-tree", tree, "-p", main, "-m", this.message(change)], {
          cwd: site.path,
          config: {
            ...AI_AUTHOR,
            "committer.name": identity["user.name"],
            "committer.email": identity["user.email"],
          },
        })
      ).trim();
      try {
        await git.run(["merge", "-q", "--ff-only", "--no-overwrite-ignore", "--end-of-options", result], {
          cwd: site.path,
          config: identity,
        });
      } catch (err) {
        if (!(err instanceof GitError) || err.kind !== "failed") throw err;
        const detail = (err.details.stderr?.trim() || err.message).slice(0, 500);
        throw new SiteError("change.merge_failed", 409, { detail });
      }
      this.close(change, "applied", result);
      return { outcome: "applied", change: await this.toChangeSet(this.get(id)), check };
    });
  }

  /** Reject a change set (plan 7.2): it is closed; the checkout is reset when the next change set opens. */
  async reject(id: string): Promise<ChangeSet> {
    const { siteId } = this.get(id);
    return this.opts.locks.run(siteId, "reject", async () => {
      this.close(this.openChange(id), "rejected");
      return this.toChangeSet(this.get(id));
    });
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

  private openChange(id: string): ChangeRecord {
    const change = this.get(id);
    if (change.status !== "open") throw new SiteError("change.not_open", 409, { status: change.status });
    return change;
  }

  /**
   * Close the change set. Its ref stays, so the snapshot can still be shown (history) and is never
   * garbage-collected; refs/bukitjalil/ goes when the site is removed from BukitJalil.
   */
  private close(change: ChangeRecord, status: "applied" | "rejected" | "stale", result?: string): void {
    this.store.resolve(change.id, status, result ?? null);
    this.emit(change.siteId);
  }

  /** The site folder must be on its default branch with nothing uncommitted (plan 7.2). */
  private async assertSiteReady(site: Site): Promise<void> {
    const { git } = this.opts;
    const head = (await git.run(["symbolic-ref", "-q", "HEAD"], { cwd: site.path, okCodes: [1] })).stdout
      .toString("utf8")
      .trim();
    if (head !== `refs/heads/${site.defaultBranch}`) {
      throw new SiteError("change.wrong_branch", 409, { branch: site.defaultBranch });
    }
    const dirty = await git.text(["status", "--porcelain=v1", "-z", "--untracked-files=no"], { cwd: site.path });
    if (dirty !== "") throw new SiteError("change.site_dirty", 409);
  }

  /** The tree of merging `theirs` onto `ours` without touching any checkout, or null on conflicts. */
  private async mergeTree(cwd: string, ours: string, theirs: string): Promise<string | null> {
    const res = await this.opts.git.run(["merge-tree", "--write-tree", "--end-of-options", ours, theirs], {
      cwd,
      okCodes: [1],
    });
    if (res.code === 1) return null;
    return res.stdout.toString("utf8").split("\n")[0]?.trim() ?? null;
  }

  /** The commit message: the AI's summary and the sessions it came from. */
  private message(change: ChangeRecord): string {
    const sessions = this.store.sessions(change.id);
    return `${change.summary?.trim() || DEFAULT_MESSAGE}\n\nBukitJalil-Sessions: ${sessions.join(", ")}\n`;
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
