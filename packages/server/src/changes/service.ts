import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  type ApplyCheck,
  type ApplyRequest,
  type ApplyResult,
  type ChangedFile,
  type ChangeSet,
  type ChangeStatus,
  type ChangeView,
  type CurrentChange,
  type FileDiff,
  type HistoryResponse,
  isBukitPluginId,
  type RestoreResult,
  type Site,
  type VersionDiff,
} from "@bukitjalil/shared";
import { parseDocument } from "yaml";
import { guardCommit } from "../bukit/guard.ts";
import { pluginStateFromDocument, setPluginInDocument } from "../bukit/plugins.ts";
import { GitError, type GitRunner } from "../git/run.ts";
import type { Logger } from "../log.ts";
import { SiteError } from "../sites/location.ts";
import type { SiteLocks } from "../sites/locks.ts";
import type { SiteService } from "../sites/service.ts";
import { storageErrorCode } from "../storage-errors.ts";
import { changedFiles, fileDiff } from "./diff.ts";
import {
  AI_AUTHOR_EMAIL,
  AI_AUTHOR_NAME,
  emptyTree,
  historyEntry,
  listHistory,
  onBranch,
  parentsOf,
} from "./history.ts";
import { selectedTree } from "./partial.ts";
import { SNAPSHOT_IDENTITY, type Snapshot, snapshotCheckout } from "./snapshot.ts";
import { type ChangeRecord, ChangeStore, isChangeId, newChangeId } from "./store.ts";

export const changeRef = (id: string) => `refs/bukitjalil/changes/${id}`;

/** Author of applied AI changes; the committer is the identity from the settings (plan 7.2). */
const AI_AUTHOR = { "author.name": AI_AUTHOR_NAME, "author.email": AI_AUTHOR_EMAIL };
const DEFAULT_MESSAGE = "Changes made with BukitJalil AI";
/** Put before the summary of what is left after a partial apply (plan 7.5). */
const REST_PREFIX = "Rest of: ";
const MAX_SUBJECT = 72;
/** site.yaml is small; a larger file is not one BukitJalil wrote and is refused rather than truncated. */
const MAX_SITE_YAML_BYTES = 1024 * 1024;
const TRAILER_LINE = /^\s*BukitJalil-[A-Za-z]+:/i;

/**
 * A summary as a commit message with a short subject line. Real models often write one long paragraph,
 * which made the history unreadable: when the first line is too long, its first sentence (cut to
 * MAX_SUBJECT characters) becomes the subject and the whole summary the body.
 */
export function commitText(summary: string): string {
  // Lines that look like our trailers would be read back as them (a forged restore marker, plan 7.4).
  summary = summary
    .split("\n")
    .filter((line) => !TRAILER_LINE.test(line))
    .join("\n")
    .trim();
  if (summary === "") return DEFAULT_MESSAGE;
  const [first = "", ...rest] = summary.split("\n");
  if ([...first.trim()].length <= MAX_SUBJECT) {
    // Git takes the whole first paragraph as the subject, so the body must start after a blank line.
    const body = rest.join("\n").trim();
    return body === "" ? first.trim() : `${first.trim()}\n\n${body}`;
  }
  const sentence = /^.+?(?:[。！？；]|[.!?;](?=\s|$))/u.exec(first.trim())?.[0] ?? first;
  const chars = [...sentence.replace(/[。；;,，:：]$/u, "")];
  const subject =
    chars.length <= MAX_SUBJECT
      ? chars.join("")
      : `${chars
          .slice(0, MAX_SUBJECT - 1)
          .join("")
          .trimEnd()}…`;
  return `${subject}\n\n${summary}`;
}

const MAX_SUMMARY_PATHS = 3;

/**
 * A one-line commit message from the changed files, for a change set without a summary (plan 6.3):
 * "Update 3 files, add 1 file: content/pages/about.md, site.yaml, themes/x/a.css, ...". Names are dropped from the end
 * until the line fits in MAX_SUBJECT; the counts always stay. The fixed text when the list is empty or
 * cut short.
 */
export function diffSummary({ files, truncated }: { files: ChangedFile[]; truncated: boolean }): string {
  if (files.length === 0 || truncated) return DEFAULT_MESSAGE;
  const count = (statuses: ChangedFile["status"][]) => files.filter((f) => statuses.includes(f.status)).length;
  const plural = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;
  const parts = (
    [
      ["update", count(["modified", "type_changed"])],
      ["add", count(["added"])],
      ["delete", count(["deleted"])],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([verb, n]) => `${verb} ${plural(n)}`);
  const joined = parts.join(", ");
  const head = `${joined.charAt(0).toUpperCase()}${joined.slice(1)}`;
  for (let shown = Math.min(files.length, MAX_SUMMARY_PATHS); shown > 0; shown--) {
    const names = files.slice(0, shown).map((f) => f.path);
    const line = `${head}: ${names.join(", ")}${files.length > shown ? ", ..." : ""}`;
    if (line.length <= MAX_SUBJECT) return line;
  }
  return head;
}

export interface ChangeServiceOptions {
  db: DatabaseSync;
  git: GitRunner;
  sites: SiteService;
  locks: SiteLocks;
  /**
   * The check before applying: Bukit on the AI checkout (AiBukit.checkForApply), with the site lock held.
   * With `commit`, `cwd` is the main checkout at that commit (a partial apply, plan 7.5).
   */
  check: (siteId: string, cwd: string, commit?: string) => Promise<ApplyCheck>;
  /** Temporary files (the index a partial apply builds its tree in). */
  tmpDir: string;
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
   * Before a run (site lock held): join the open change set, or start one. A new one resets the ai/
   * checkout to the head of the default branch and cleans it (plan 7.2), records that commit as the base
   * and pins it with refs/bukitjalil/changes/<id>. Returns the checkout to run in and `previous`: how the
   * newest other change set this session took part in ended, if it did. The working copy was reset since
   * then, which the AI is told once per change set (plan 6.2).
   */
  async begin(
    siteId: string,
    sessionId: string,
  ): Promise<{ cwd: string; change: ChangeRecord; previous: Exclude<ChangeStatus, "open"> | null }> {
    const { cwd, change } = await this.openChangeSet(siteId, sessionId);
    const previous = this.store.lastJoined(sessionId, change.id);
    this.store.addSession(change.id, sessionId);
    this.emit(siteId);
    return { cwd, change, previous };
  }

  /** Open the site's change set for a Settings edit, without a conversation. */
  private async beginUserChange(siteId: string): Promise<{ cwd: string; change: ChangeRecord; created: boolean }> {
    return this.openChangeSet(siteId, null);
  }

  private async openChangeSet(
    siteId: string,
    sessionId: string | null,
  ): Promise<{ cwd: string; change: ChangeRecord; created: boolean }> {
    const { sites, git } = this.opts;
    const site = sites.get(siteId);
    if (site.readOnly) throw new SiteError("site.read_only", 409);
    const open = this.store.open(siteId);
    if (open) {
      // Keep the files as the last run left them; a checkout that went missing comes back at the snapshot.
      const cwd = await sites.aiWorktree(siteId, open.snapshotCommit, { reset: false });
      return { cwd, change: open, created: false };
    }
    const head = await sites.headOf(site);
    const cwd = await sites.aiWorktree(siteId, head, { reset: true });
    const id = newChangeId();
    await git.run(["update-ref", changeRef(id), head], { cwd: site.path });
    const change = this.store.insert({ id, siteId, sessionId, baseCommit: head });
    return { cwd, change, created: true };
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
   * Turn a built-in Bukit plugin on or off for one site. It edits the AI checkout and snapshots it, so
   * the switch becomes a normal reviewable change set; nothing is written to the default branch here.
   */
  async setPlugin(siteId: string, pluginId: string, enabled: boolean): Promise<CurrentChange> {
    if (!isBukitPluginId(pluginId)) throw new SiteError("plugin.unknown", 400);
    return this.opts.locks.run(siteId, "config", async () => {
      const site = this.opts.sites.get(siteId);
      if (site.readOnly) throw new SiteError("site.read_only", 409);
      const { cwd, change, created } = await this.beginUserChange(siteId);
      try {
        const file = path.join(cwd, "site.yaml");
        let raw: string;
        try {
          const stat = fs.lstatSync(file);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SITE_YAML_BYTES)
            throw new SiteError("config.invalid_yaml", 409);
          raw = fs.readFileSync(file, "utf8");
        } catch (err) {
          if (err instanceof SiteError) throw err;
          if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new SiteError("site.no_site_yaml", 409);
          throw new SiteError(storageErrorCode(err) ?? "config.write_failed", 409);
        }

        const doc = parseDocument(raw);
        if (doc.errors.length > 0) throw new SiteError("config.invalid_yaml", 409);
        const current = pluginStateFromDocument(doc, pluginId);
        if (!current) throw new SiteError("config.plugins_invalid", 409);
        if (current.enabled === enabled) {
          // A click that changes nothing: do not leave an empty change set behind.
          if (created) await this.close(change, "rejected");
          return { change: await this.current(siteId, false) };
        }

        try {
          setPluginInDocument(doc, pluginId, enabled);
        } catch {
          throw new SiteError("config.plugins_invalid", 409);
        }
        try {
          fs.writeFileSync(file, doc.toString({ lineWidth: 0 }));
        } catch (err) {
          throw new SiteError(storageErrorCode(err) ?? "config.write_failed", 409);
        }
        await this.snapshot(siteId, cwd);
        if (this.store.sessions(change.id).length === 0) {
          this.store.setSummary(change.id, `Plugin settings: ${pluginId} ${enabled ? "on" : "off"}`);
        }
        this.emit(siteId);
        return { change: await this.current(siteId, false) };
      } catch (err) {
        // Do not strand a change set this request created; an existing AI change set is left untouched.
        if (created && this.store.open(siteId)?.id === change.id) await this.close(change, "rejected");
        throw err;
      }
    });
  }

  /** A site bound to a Notion data source whose default branch (at `main`) already uses Notion. */
  private async notionSite(site: Site, main: string): Promise<boolean> {
    if (this.opts.sites.notionDataSourceId(site.id) === null) return false;
    const guard = await guardCommit(this.opts.git, site.path, main);
    return guard.ok && guard.usesNotion;
  }

  /**
   * Apply a change set (plan 7.2), under the site lock: snapshot the checkout again and compare it with the
   * fingerprint the user reviewed; if the default branch moved since the base, merge onto it and ask for
   * another review (or close the change set as stale on conflicts); run the check; commit the snapshot's
   * tree on the default branch (author BukitJalil AI, committer from the settings) and fast-forward the
   * site folder to it, refusing to overwrite ignored local files. With `selection`, only those files (plan
   * 7.5): see applyPartial.
   */
  async apply(id: string, req: ApplyRequest): Promise<ApplyResult> {
    const { siteId } = this.get(id);
    return this.opts.locks.run(siteId, "apply", async () => {
      const { git, sites } = this.opts;
      const open = this.openChange(id);
      const site = sites.get(siteId);
      if (site.readOnly) throw new SiteError("site.read_only", 409);
      // A restore brings back version V as a whole; its trailer would say so of a part too (plan 7.5).
      if (req.selection && open.restoreCommit !== null) throw new SiteError("change.partial_restore", 400);
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
          await this.close(change, "stale");
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

      if (req.selection) {
        const selected = await selectedTree(git, {
          cwd: site.path,
          base: change.baseCommit,
          snapshot: change.snapshotCommit,
          selection: req.selection,
          tmpDir: this.opts.tmpDir,
        });
        if (selected === (await this.treeOf(site.path, change.baseCommit))) {
          throw new SiteError("change.nothing_selected", 400);
        }
        // Everything selected is a whole apply.
        if (selected !== tree) return this.applyPartial(change, site, cwd, main, selected, req);
      }

      const check = await this.opts.check(siteId, cwd);
      // The check snapshots too; it must still be what the user reviewed.
      change = this.openChange(id);
      if ((await this.treeOf(site.path, change.snapshotCommit)) !== req.treeHash) {
        throw new SiteError("change.fingerprint_mismatch", 409);
      }
      // A Notion site cannot be checked before applying (unreviewed content never gets the token); that is
      // not a failed check, so it needs no force. Only for a bound site whose default branch already uses
      // Notion: a change that adds a Notion source itself must not skip the check that way. The guard still
      // ran, and the main build checks the result.
      const unchecked = check.problemCode === "notion" && (await this.notionSite(site, main));
      if (!check.passed && !req.force && !unchecked)
        return { outcome: "check_failed", change: await this.toChangeSet(change), check };

      // A restore is the user's own act, so they are its author too (plan 7.4); once a conversation has taken
      // part, the AI wrote part of it. The flag outlives a deleted conversation and a rebase onto a newer main.
      // A change set with no conversation at all is a Settings edit, also the user's own act.
      const sessions = this.store.sessions(change.id);
      const pureRestore = change.restoreCommit !== null && !change.aiJoined;
      const userAuthored = change.restoreCommit === null && sessions.length === 0;
      const author =
        pureRestore || userAuthored
          ? { "author.name": identity["user.name"], "author.email": identity["user.email"] }
          : AI_AUTHOR;
      // Without a summary from the AI (summarize_changes), the message says what changed (plan 6.3).
      const text =
        change.summary?.trim() ||
        diffSummary(await changedFiles(git, site.path, change.baseCommit, change.snapshotCommit));
      const result = (
        await git.text(["commit-tree", tree, "-p", main, "-m", this.message(change, sessions, text)], {
          cwd: site.path,
          config: { ...author, "committer.name": identity["user.name"], "committer.email": identity["user.email"] },
        })
      ).trim();
      // The check can take minutes, and the site folder is the user's: it must still be on the default branch
      // and clean, or the fast-forward would move whatever branch is checked out now.
      await this.assertSiteReady(site);
      // The branch itself may have moved meanwhile too; after a `reset --hard HEAD~1` the fast-forward would
      // quietly bring the dropped commit back. Applying again merges onto where it is now.
      if ((await sites.headOf(site)) !== main) {
        throw new SiteError("change.merge_failed", 409, { detail: `${site.defaultBranch} moved during the check` });
      }
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
      await this.close(change, "applied", result);
      return { outcome: "applied", change: await this.toChangeSet(this.get(id)), check };
    });
  }

  /**
   * Apply the `selected` tree (plan 7.5), with the site lock held and the default branch still at the
   * change set's base: commit it on the default branch, check that commit in the main checkout (the AI
   * checkout is not touched, since checking it would snapshot it), fast-forward the site folder, then move
   * the change set onto the result with the rest of the snapshot, so the review shows what is left.
   */
  private async applyPartial(
    change: ChangeRecord,
    site: Site,
    cwd: string,
    main: string,
    selected: string,
    req: ApplyRequest,
  ): Promise<ApplyResult> {
    const { git, sites } = this.opts;
    const identity = sites.commitIdentity();
    const sessions = this.store.sessions(change.id);
    // Restores never get here, so the author is the AI once a conversation took part, else the user.
    const author =
      sessions.length === 0
        ? { "author.name": identity["user.name"], "author.email": identity["user.email"] }
        : AI_AUTHOR;
    const subject = diffSummary(await changedFiles(git, site.path, change.baseCommit, selected));
    const summary = change.summary?.trim();
    const whole = summary?.startsWith(REST_PREFIX) ? summary.slice(REST_PREFIX.length) : summary;
    const text = whole ? `${subject}\n\nPart of: ${whole}` : subject;
    const result = (
      await git.text(["commit-tree", selected, "-p", main, "-m", this.message(change, sessions, text)], {
        cwd: site.path,
        config: { ...author, "committer.name": identity["user.name"], "committer.email": identity["user.email"] },
      })
    ).trim();

    const checkout = await sites.mainCheckout(site.id, site.path, result);
    const check = await this.opts.check(site.id, checkout, result);
    const unchecked = check.problemCode === "notion" && (await this.notionSite(site, main));
    if (!check.passed && !req.force && !unchecked) {
      // Bukit's caches in the main checkout survive its resets; content that was not applied must not seed
      // the next main build.
      for (const dir of [".bukit", ".cache"]) fs.rmSync(path.join(checkout, dir), { recursive: true, force: true });
      return { outcome: "check_failed", change: await this.toChangeSet(this.openChange(change.id)), check };
    }
    // As for a whole apply: the user's folder must still be ready, and the branch where it was.
    await this.assertSiteReady(site);
    if ((await sites.headOf(site)) !== main) {
      throw new SiteError("change.merge_failed", 409, { detail: `${site.defaultBranch} moved during the check` });
    }
    // Nothing ran in the AI checkout meanwhile (the site lock is held), but compare anyway: the rest is
    // computed from the snapshot the user reviewed.
    const now = this.openChange(change.id);
    const tree = await this.treeOf(site.path, now.snapshotCommit);
    if (now.snapshotCommit !== change.snapshotCommit || tree !== req.treeHash) {
      throw new SiteError("change.fingerprint_mismatch", 409);
    }
    // The rest: the same snapshot tree on top of the result, made before the default branch moves so that
    // nothing after the fast-forward can fail but bookkeeping. The checkout's files stay as they are.
    const rest = (
      await git.text(["commit-tree", tree, "-p", result, "-m", "BukitJalil AI snapshot (rest after partial apply)"], {
        cwd: site.path,
        config: SNAPSHOT_IDENTITY,
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

    this.store.rebase(change.id, result, rest);
    // A later whole apply of the rest must not describe the part applied now as well.
    if (summary && !summary.startsWith(REST_PREFIX)) this.store.setSummary(change.id, `${REST_PREFIX}${summary}`);
    // The default branch has moved and the change set says so; the ref and the checkout's HEAD follow. If
    // either fails, the snapshot still points at the same tree, and the next snapshot moves them.
    try {
      await git.run(["update-ref", changeRef(change.id), rest], { cwd: site.path });
      await git.run(["reset", "-q", "--soft", rest], { cwd });
    } catch (err) {
      this.opts.logger.log("warn", "changes.partial_followup_failed", { changeId: change.id, error: String(err) });
    }
    this.emit(site.id);
    return { outcome: "partial", change: await this.toChangeSet(this.get(change.id)), check };
  }

  /** Reject a change set (plan 7.2): it is closed; the checkout is reset when the next change set opens. */
  async reject(id: string): Promise<ChangeSet> {
    const { siteId } = this.get(id);
    return this.opts.locks.run(siteId, "reject", async () => {
      await this.close(this.openChange(id), "rejected");
      return this.toChangeSet(this.get(id));
    });
  }

  /** A page of the default branch's history (plan 7.4), newest first. */
  async history(siteId: string, skip: number): Promise<HistoryResponse> {
    const site = this.opts.sites.get(siteId);
    return listHistory(this.opts.git, site.path, site.defaultBranch, { skip });
  }

  /** What a version changed against its first parent: the file list, or one file's diff with `path`. */
  async versionDiff(siteId: string, commit: string): Promise<VersionDiff>;
  async versionDiff(siteId: string, commit: string, path: string): Promise<FileDiff>;
  async versionDiff(siteId: string, commit: string, path?: string): Promise<VersionDiff | FileDiff> {
    const site = this.opts.sites.get(siteId);
    const { git } = this.opts;
    if (!(await onBranch(git, site.path, commit, site.defaultBranch))) throw new SiteError("history.not_found", 404);
    if (path === undefined) {
      const entry = await historyEntry(git, site.path, commit);
      const parent = entry.parents[0] ?? (await emptyTree(git, site.path));
      const { files, truncated } = await changedFiles(git, site.path, parent, commit);
      return { entry, files, filesTruncated: truncated };
    }
    const parent = (await parentsOf(git, site.path, commit))[0] ?? (await emptyTree(git, site.path));
    const { files } = await changedFiles(git, site.path, parent, commit, { path });
    const file = files.find((f) => f.path === path);
    if (!file) throw new SiteError("change.file_not_found", 404);
    return fileDiff(git, site.path, parent, commit, file);
  }

  /**
   * Restore a version (plan 7.4), under the site lock: a change set whose snapshot holds that version's
   * tree on top of the current default branch, reviewed and applied like any other. An open change set
   * with changes in it must be applied or rejected first; an empty one (a conversation that changed
   * nothing) is closed instead. The pre-build guard's verdict on that version is returned; it does not
   * stop the restore. The caller makes sure no run is active or queued.
   */
  async restore(siteId: string, commit: string): Promise<RestoreResult> {
    return this.opts.locks.run(siteId, "restore", async () => {
      const { git, sites } = this.opts;
      const site = sites.get(siteId);
      if (site.readOnly) throw new SiteError("site.read_only", 409);
      const open = this.store.open(siteId);
      if (
        open &&
        (await this.treeOf(site.path, open.snapshotCommit)) !== (await this.treeOf(site.path, open.baseCommit))
      )
        throw new SiteError("change.open_exists", 409);
      if (!(await onBranch(git, site.path, commit, site.defaultBranch))) throw new SiteError("history.not_found", 404);
      const main = await sites.headOf(site);
      const tree = await this.treeOf(site.path, commit);
      if (tree === (await this.treeOf(site.path, main))) throw new SiteError("change.same_version", 409);
      const guard = await guardCommit(git, site.path, commit);
      const entry = await historyEntry(git, site.path, commit);

      if (open) await this.close(open, "rejected");
      const snapshot = (
        await git.text(["commit-tree", tree, "-p", main, "-m", "BukitJalil restore snapshot"], {
          cwd: site.path,
          config: SNAPSHOT_IDENTITY,
        })
      ).trim();
      // The AI checkout holds the restored version, so a conversation can go on from it.
      await sites.aiWorktree(siteId, snapshot, { reset: true });
      const id = newChangeId();
      await git.run(["update-ref", changeRef(id), snapshot], { cwd: site.path });
      const change = this.store.insert({
        id,
        siteId,
        sessionId: null,
        baseCommit: main,
        snapshotCommit: snapshot,
        restoreCommit: commit,
        summary: `Restore to ${commit.slice(0, 7)}${entry.subject ? `: ${entry.subject}` : ""}`,
      });
      this.emit(siteId);
      return { change: await this.toChangeSet(change), guard: { ok: guard.ok, reasons: guard.reasons } };
    });
  }

  /** The snapshot commit of the site's open change set (what ref=change shows), or null. */
  openSnapshot(siteId: string): string | null {
    return this.store.open(siteId)?.snapshotCommit ?? null;
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
      restoreOf: change.restoreCommit,
    };
  }

  private openChange(id: string): ChangeRecord {
    const change = this.get(id);
    if (change.status !== "open") throw new SiteError("change.not_open", 409, { status: change.status });
    return change;
  }

  /**
   * Close the change set. An applied snapshot stays pinned by its ref; the applied commit already shares its
   * tree, and the ref is part of the review history. Rejected and stale snapshots have no UI and are not
   * worth keeping forever: their ref goes, so Git can collect the work. The refs/bukitjalil/ area also goes
   * when the site is removed.
   */
  private async close(change: ChangeRecord, status: "applied" | "rejected" | "stale", result?: string): Promise<void> {
    this.store.resolve(change.id, status, result ?? null);
    if (status !== "applied") {
      try {
        const site = this.opts.sites.get(change.siteId);
        await this.opts.git.run(["update-ref", "-d", changeRef(change.id)], { cwd: site.path });
      } catch (err) {
        // Closing must not fail because the ref was already gone or the repository is no longer writable.
        this.opts.logger.log("warn", "changes.ref_delete_failed", { changeId: change.id, error: String(err) });
      }
    }
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

  /** The commit message: `text` (the summary), the sessions it came from and the version it restores. */
  private message(change: ChangeRecord, sessions: string[], text: string): string {
    const trailers = [
      ...(sessions.length > 0 ? [`BukitJalil-Sessions: ${sessions.join(", ")}`] : []),
      ...(change.restoreCommit ? [`BukitJalil-Restore: ${change.restoreCommit}`] : []),
    ];
    const summary = commitText(text);
    return trailers.length > 0 ? `${summary}\n\n${trailers.join("\n")}\n` : `${summary}\n`;
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
