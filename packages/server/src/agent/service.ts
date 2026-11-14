import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { SessionInfo, SessionMessage, SessionStatus, SkillsResponse, ThinkingLevel } from "@bukitjalil/shared";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent, ModelRuntime, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ChangeService } from "../changes/service.ts";
import type { Logger } from "../log.ts";
import type { AppPaths } from "../paths.ts";
import { asSiteError, SiteError } from "../sites/location.ts";
import type { SiteLocks } from "../sites/locks.ts";
import type { SiteService } from "../sites/service.ts";
import { storageErrorCode } from "../storage-errors.ts";
import type { AiBukit } from "./ai-bukit.ts";
import { PathGate } from "./gate.ts";
import { hasAuth } from "./models.ts";
import { loadPi, type PiModules } from "./pi.ts";
import { buildSystemPrompt, createModelRuntime, createResourceLoader, createSettings } from "./runtime.ts";
import type { SecretCredentialStore } from "./secret-credentials.ts";
import { createSiteTools, SITE_TOOLS } from "./site-tools.ts";
import { listSkills, skillReadRoots } from "./skills.ts";
import { isSessionId, newSessionId, type SessionRecord, SessionStore } from "./store.ts";
import { autoTitle } from "./title.ts";
import { BUILTIN_TOOLS, createGatedTools } from "./tools.ts";

const IDLE_MS = 10 * 60_000;
/** Longest shutdown waits for a model request that ignores abort. */
const SHUTDOWN_WAIT_MS = 10_000;

export type { SessionStatus };

/** What a session does, for the event stream: Pi's own events, status changes, and changes to the list. */
export type AgentEvent = { siteId: string; sessionId: string } & (
  | { type: "pi"; event: AgentSessionEvent }
  | { type: "status"; status: SessionStatus; error?: string }
  /** summarize_changes: the AI's description of its changes, for the review (also kept with the change set). */
  | { type: "summary"; summary: string }
  /** The session was created, renamed or forked from another. */
  | { type: "session"; session: SessionInfo }
  | { type: "deleted" }
);

export interface AgentServiceOptions {
  db: DatabaseSync;
  paths: AppPaths;
  sites: SiteService;
  /** The site lock: a run holds it from start to end; while another operation holds it, runs wait. */
  locks: SiteLocks;
  /** Change sets: opened before a run, snapshotted after it (plan 7.2). */
  changes: ChangeService;
  logger: Logger;
  /**
   * The model to use, or undefined when none is chosen; read before every run, so a change in the settings
   * applies to the next message. Throws agent.model_not_found when the chosen model is gone.
   */
  resolveModel: (runtime: ModelRuntime, pi: PiModules) => Model<Api> | undefined;
  /** Thinking level for every run; Pi clamps it to the model. */
  thinkingLevel?: () => ThinkingLevel;
  /** Encrypted model keys (plan 6.7); Pi's auth.json is used without it. */
  credentials?: SecretCredentialStore;
  /** Called once on the new model runtime (tests register a fake provider). */
  setupRuntime?: (runtime: ModelRuntime, pi: PiModules) => void;
  /** BukitJalil's rg is installed and verified; grep is refused otherwise (plan 6.3). */
  rgReady: () => boolean;
  /** Bukit for the site tools: lock, snapshot and guard before each check or build. */
  bukit: AiBukit;
  /** BukitJalil's skills (plan 6.4): listed in the system prompt, readable but never writable by the AI. */
  skillsDir: string;
  /** Optional skills turned off in Settings; read before every session opens. */
  disabledSkills?: () => readonly string[];
  /** Dispose an unused AgentSession after this long; its file stays (plan 6.2). */
  idleMs?: number;
  /** Longest shutdown waits for runs that ignore abort (tests set it short). */
  shutdownMs?: number;
}

interface Live {
  siteId: string;
  session: AgentSession;
  unsubscribe: () => void;
  idleTimer: NodeJS.Timeout | null;
}

interface Pending {
  sessionId: string;
  texts: string[];
}

/** The run of one session; at most one per site. */
interface Run {
  sessionId: string;
  /** Set by stop, delete, site removal or shutdown: no further prompt is sent. */
  cancelled: boolean;
  /** Messages that arrived while the session was not streaming (opening, or between prompts). */
  extra: string[];
  /** The AI checkout of the run's change set, once the run has one; snapshotted when the run ends. */
  cwd: string | null;
  /** Settles when the run has ended and touched nothing more. */
  done: Promise<void>;
}

/** customType of the note that tells the model its working copy was reset (plan 6.2). */
export const RESET_NOTE_TYPE = "bukitjalil.worktree_reset";

const RESET_OUTCOME = {
  applied: "was applied to the main version",
  rejected: "was closed without being applied",
  stale: "was closed because it conflicted with newer changes on the main version",
} as const;

/**
 * The note for a conversation whose last change set ended as `previous`. `restoring`: the new change set
 * starts from an older version the user is restoring, not from the latest main version.
 */
export function resetNote(previous: keyof typeof RESET_OUTCOME, restoring = false): string {
  const target = restoring ? "the older version the user is restoring" : "the latest main version";
  return [
    `Note from BukitJalil: since your last turn, the working copy was reset to ${target}.`,
    `The change set your earlier edits were in ${RESET_OUTCOME[previous]}.`,
    "Read files again before editing them; what you remember of them may be out of date.",
  ].join(" ");
}

/**
 * AI sessions (plan 6.2). A session is a row in `sessions` and a Pi session file; its AgentSession is made
 * when a message arrives and disposed after a while unused. One session per site runs at a time: messages
 * for other sessions of that site wait in order.
 */
export class AgentService {
  readonly store: SessionStore;
  private readonly live = new Map<string, Live>();
  private readonly pending = new Map<string, Pending[]>();
  /** siteId -> the run there. */
  private readonly running = new Map<string, Run>();
  /** Sites whose queued messages wait for another operation to free the site lock. */
  private readonly waiting = new Set<string>();
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private runtime: Promise<ModelRuntime> | null = null;
  private closing = false;

  constructor(private readonly opts: AgentServiceOptions) {
    this.store = new SessionStore(opts.db);
    opts.sites.onRemoving((siteId) => this.closeSite(siteId));
  }

  /** Pi's own directory (auth.json, models.json). */
  /** The encrypted model keys, when the app keeps them (plan 6.7). */
  get credentials(): SecretCredentialStore | undefined {
    return this.opts.credentials;
  }

  get piDir(): string {
    return this.opts.paths.pi;
  }

  /** Pi's modules, loaded on first use. */
  piModules(): Promise<PiModules> {
    return this.pi();
  }

  /** The skills loaded from BukitJalil's directory, with the current on/off setting. */
  async skills(): Promise<SkillsResponse> {
    const pi = await this.pi();
    return listSkills(pi, this.opts.skillsDir, this.opts.paths.pi, this.opts.disabledSkills?.() ?? []);
  }

  /** The one model runtime (catalog and keys) every session and the model settings use. */
  models(): Promise<ModelRuntime> {
    return this.modelRuntime();
  }

  /** Listen to every session's events; returns the function that stops listening. */
  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(siteId: string): SessionRecord[] {
    this.opts.sites.get(siteId);
    return this.store.list(siteId);
  }

  get(id: string): SessionRecord {
    const session = isSessionId(id) ? this.store.get(id) : null;
    if (!session) throw new SiteError("session.not_found", 404);
    return session;
  }

  status(id: string): SessionStatus {
    return this.info(id).status;
  }

  /** A session as the API shows it: the record without its file path, and its status. */
  info(id: string): SessionInfo {
    return this.toInfo(this.get(id));
  }

  listInfo(siteId: string): SessionInfo[] {
    return this.list(siteId).map((s) => this.toInfo(s));
  }

  /** A session of the site is running or has messages waiting: its change set is about to change. */
  busy(siteId: string): boolean {
    return this.running.has(siteId) || (this.pending.get(siteId)?.length ?? 0) > 0;
  }

  private toInfo({ file: _, ...record }: SessionRecord): SessionInfo {
    const run = this.running.get(record.siteId);
    const queued = this.pending.get(record.siteId)?.some((p) => p.sessionId === record.id);
    return { ...record, status: run?.sessionId === record.id ? "running" : queued ? "queued" : "idle" };
  }

  /**
   * The messages of the session's current branch (plan 9.1), from its AgentSession when in memory (it
   * also has the messages of the run in progress), else from its file. A session without a file has none.
   */
  async messages(id: string): Promise<SessionMessage[]> {
    const record = this.get(id);
    const live = this.live.get(id);
    let entries: SessionEntry[];
    if (live) {
      entries = live.session.sessionManager.getBranch();
    } else {
      if (!fs.existsSync(record.file)) return [];
      entries = (await this.openFile(record)).getBranch();
    }
    // The system prompt is stored as a message too; it is not part of the conversation the user sees.
    return entries.flatMap((e) =>
      e.type === "message" && e.message.role !== "system" ? [{ entryId: e.id, message: e.message as never }] : [],
    );
  }

  /**
   * A new session with the path from the start to `entryId` of this one (plan 6.2). Pi writes the branch
   * to a file of its own naming in the site's session directory; it is renamed to the new session's file.
   * The source is read from its file, where Pi appends each message as it ends, even while it runs.
   */
  async fork(id: string, entryId: string): Promise<SessionRecord> {
    this.assertOpen();
    const source = this.get(id);
    const site = this.opts.sites.get(source.siteId);
    if (site.readOnly) throw new SiteError("site.read_only", 409);
    if (!fs.existsSync(source.file)) throw new SiteError("session.entry_not_found", 404);
    const dir = this.sessionDir(site.id);
    const manager = await this.openFile(source);
    if (!manager.getEntry(entryId)) throw new SiteError("session.entry_not_found", 404);
    this.assertOpen();
    const newId = newSessionId();
    const file = path.join(dir, `${newId}.jsonl`);
    const written = manager.createBranchedSession(entryId);
    // Pi writes the file only when the branch holds a conversation; otherwise the new session starts empty.
    if (written && fs.existsSync(written)) fs.renameSync(written, file);
    this.store.insert({ id: newId, siteId: site.id, file });
    if (source.title) this.store.rename(newId, source.title);
    return this.announce(newId);
  }

  /** A session's file in a Pi session manager; a file Pi cannot read is reported as such. */
  private async openFile(record: SessionRecord, cwd?: string) {
    const pi = await this.pi();
    try {
      return pi.pi.SessionManager.open(record.file, this.sessionDir(record.siteId), cwd);
    } catch (err) {
      this.opts.logger.log("warn", "agent.session_unreadable", { sessionId: record.id, error: String(err) });
      throw new SiteError("session.unreadable", 409);
    }
  }

  /** Tell the event stream about a new or changed session. */
  private announce(id: string): SessionRecord {
    const record = this.get(id);
    this.emit({ siteId: record.siteId, sessionId: id, type: "session", session: this.toInfo(record) });
    return record;
  }

  /** Record a new session; its AgentSession and file are made with the first message. */
  create(siteId: string): SessionRecord {
    this.assertOpen();
    const site = this.opts.sites.get(siteId);
    if (site.readOnly) throw new SiteError("site.read_only", 409);
    const id = newSessionId();
    this.store.insert({ id, siteId, file: path.join(this.sessionDir(siteId), `${id}.jsonl`) });
    return this.announce(id);
  }

  rename(id: string, title: string | null): SessionRecord {
    this.get(id);
    this.store.rename(id, title);
    return this.announce(id);
  }

  /** Stop the session and wait for its run to end, then delete its record and file. */
  async delete(id: string): Promise<void> {
    const session = this.get(id);
    await this.stop(id);
    const run = this.running.get(session.siteId);
    if (run?.sessionId === id) await run.done;
    this.dispose(id);
    this.store.delete(id);
    fs.rmSync(session.file, { force: true });
    this.emit({ siteId: session.siteId, sessionId: id, type: "deleted" });
  }

  /**
   * Send a message (plan 6.2). A running session gets it as a steering message, or after the current run
   * with `followUp`; if it is still opening, the message is sent once the current prompt ends. Otherwise
   * it waits for the site's running session, if any, then starts a run; messages sent while waiting are
   * joined into one. Resolves once the message is accepted.
   */
  async send(id: string, text: string, opts: { followUp?: boolean } = {}): Promise<void> {
    this.assertOpen();
    const session = this.get(id);
    if (this.opts.sites.get(session.siteId).readOnly) throw new SiteError("site.read_only", 409);
    // The first message names the conversation; manual rename can still replace it later.
    if (!session.title) {
      const title = autoTitle(text);
      if (title) {
        this.store.rename(id, title);
        this.announce(id);
      }
    }
    const run = this.running.get(session.siteId);
    if (run?.sessionId === id && !run.cancelled) {
      const live = this.live.get(id);
      if (live?.session.isStreaming) await (opts.followUp ? live.session.followUp(text) : live.session.steer(text));
      else run.extra.push(text);
      return;
    }
    // Fail now, not inside the queued run, when no model is set up.
    await this.model();
    this.assertOpen();
    const queue = this.pending.get(session.siteId) ?? [];
    this.pending.set(session.siteId, queue);
    const waiting = queue.find((p) => p.sessionId === id);
    if (waiting) waiting.texts.push(text);
    else queue.push({ sessionId: id, texts: [text] });
    if (this.running.has(session.siteId) || this.opts.locks.holder(session.siteId) !== null)
      this.emit({ siteId: session.siteId, sessionId: id, type: "status", status: "queued" });
    this.pump(session.siteId);
  }

  /** Stop a running session (plan 6.2), even one still opening, or drop its waiting messages. */
  async stop(id: string): Promise<void> {
    const session = this.get(id);
    this.dropPending(session.siteId, (p) => p.sessionId === id);
    const run = this.running.get(session.siteId);
    if (run?.sessionId === id) await this.cancel(run);
  }

  /** Stop every session of a site and wait for its run to end, before the site is removed. */
  async closeSite(siteId: string): Promise<void> {
    this.dropPending(siteId, () => true);
    const run = this.running.get(siteId);
    if (run) {
      await this.cancel(run);
      await run.done;
    }
    for (const [id, live] of [...this.live]) if (live.siteId === siteId) this.dispose(id);
  }

  /** Stop all sessions, wait for their runs to end and dispose them (server shutdown). */
  async shutdown(): Promise<void> {
    this.closing = true;
    this.pending.clear();
    const runs = [...this.running.values()];
    await Promise.all(runs.map((run) => this.cancel(run)));
    if (runs.length > 0) {
      let timer: NodeJS.Timeout | undefined;
      const ended = await Promise.race([
        Promise.all(runs.map((run) => run.done)).then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), this.opts.shutdownMs ?? SHUTDOWN_WAIT_MS);
          timer.unref();
        }),
      ]);
      clearTimeout(timer);
      if (!ended) this.opts.logger.log("warn", "agent.shutdown_timeout", { runs: runs.length });
    }
    for (const id of [...this.live.keys()]) this.dispose(id);
  }

  // --- internals ---

  private assertOpen(): void {
    if (this.closing) throw new SiteError("server.shutting_down", 503);
  }

  private sessionDir(siteId: string): string {
    return path.join(this.opts.paths.sessions, siteId);
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        this.opts.logger.log("error", "agent.listener_failed", { error: String(err) });
      }
    }
  }

  /** Remove waiting sessions of a site; each gets an idle status. */
  private dropPending(siteId: string, match: (p: Pending) => boolean): void {
    const queue = this.pending.get(siteId) ?? [];
    for (const p of queue.filter(match)) this.emit({ siteId, sessionId: p.sessionId, type: "status", status: "idle" });
    this.pending.set(
      siteId,
      queue.filter((p) => !match(p)),
    );
  }

  /** Mark the run cancelled and abort its prompt if one is streaming. */
  private async cancel(run: Run): Promise<void> {
    run.cancelled = true;
    run.extra = [];
    await this.live.get(run.sessionId)?.session.abort();
  }

  private pi(): Promise<PiModules> {
    return loadPi(this.opts.paths.pi);
  }

  /**
   * Build the model runtime again at its next use: custom models registered while the desktop app's key
   * was still on its way could not be read (plan 6.7). Running sessions keep theirs.
   */
  refreshModelRuntime(): void {
    this.runtime = null;
  }

  private modelRuntime(): Promise<ModelRuntime> {
    if (!this.runtime) {
      const runtime = this.pi().then(async (pi) => {
        const created = await createModelRuntime(pi, this.opts.paths.pi, this.opts.credentials);
        this.opts.setupRuntime?.(created, pi);
        return created;
      });
      runtime.catch(() => {
        if (this.runtime === runtime) this.runtime = null;
      });
      this.runtime = runtime;
    }
    return this.runtime;
  }

  private async model(): Promise<Model<Api>> {
    const [pi, runtime] = await Promise.all([this.pi(), this.modelRuntime()]);
    const model = this.opts.resolveModel(runtime, pi);
    if (!model) throw new SiteError("agent.no_model", 409);
    if (!(await hasAuth(runtime, model.provider))) {
      throw new SiteError("agent.no_api_key", 409, { provider: model.provider });
    }
    return model;
  }

  /** Use the model and thinking level of the settings, which may have changed since the session opened. */
  private async applyModel(session: AgentSession): Promise<void> {
    const model = await this.model();
    const current = session.model;
    if (current?.provider !== model.provider || current.id !== model.id) await session.setModel(model);
    const level = this.opts.thinkingLevel?.();
    if (level && session.thinkingLevel !== level) session.setThinkingLevel(level);
  }

  /**
   * Start the site's next queued run. The run holds the site lock from start to end (plan 7.2); while a
   * build or another operation holds it, the messages stay queued and the run starts once it is free.
   */
  private pump(siteId: string): void {
    if (this.running.has(siteId) || this.closing) return;
    if (!this.pending.get(siteId)?.length) return;
    let release: () => void;
    try {
      release = this.opts.locks.acquire(siteId, "session");
    } catch (err) {
      if (!(err instanceof SiteError) || err.code !== "site.busy") throw err;
      if (!this.waiting.has(siteId)) {
        this.waiting.add(siteId);
        void this.opts.locks.waitFree(siteId).then(() => {
          this.waiting.delete(siteId);
          this.pump(siteId);
        });
      }
      return;
    }
    const next = this.pending.get(siteId)?.shift();
    if (!next) {
      release();
      return;
    }
    const run: Run = { sessionId: next.sessionId, cancelled: false, extra: [], cwd: null, done: Promise.resolve() };
    this.running.set(siteId, run);
    const base = { siteId, sessionId: next.sessionId, type: "status" } as const;
    this.emit({ ...base, status: "running" });
    run.done = this.execute(run, next.texts.join("\n\n"))
      .then(async (error) => {
        // An aborted check or build may still be stopping Bukit: the lock stays until it has.
        await this.opts.bukit.settled(siteId);
        return (await this.snapshotAfter(siteId, run)) ?? error;
      })
      // execute and snapshotAfter do not reject, but if anything in them does, the lock is still released.
      .catch((err: unknown) => runErrorCode(err))
      .then((error) => {
        this.running.delete(siteId);
        release();
        // Messages that arrived after the last prompt ended, while the run was still finishing (Bukit
        // stopping, the snapshot): they start the session's next run instead of being dropped. Not after a
        // failure: with no model or key, or a change set that could not open, the next run fails the same way.
        const requeued = run.extra.length > 0 && !error && !run.cancelled && !this.closing;
        if (requeued) this.requeue(siteId, run.sessionId, run.extra.splice(0));
        try {
          if (requeued) this.emit({ ...base, status: "queued" });
          else this.emit(error ? { ...base, status: "idle", error } : { ...base, status: "idle" });
          // Whether the change set can be reviewed depends on the run: say so even when no file changed.
          if (run.cwd) this.opts.changes.notify(siteId);
          this.pump(siteId);
        } catch (err) {
          this.opts.logger.log("error", "agent.after_run_failed", { sessionId: run.sessionId, error: String(err) });
        }
      });
  }

  /** Put messages first in line for `sessionId`, joined with any it already has waiting. */
  private requeue(siteId: string, sessionId: string, texts: string[]): void {
    const queue = this.pending.get(siteId) ?? [];
    this.pending.set(siteId, queue);
    const waiting = queue.find((p) => p.sessionId === sessionId);
    if (waiting) waiting.texts.unshift(...texts);
    else queue.unshift({ sessionId, texts });
  }

  /**
   * After a run, still holding the lock: snapshot what the AI left in the checkout into the change set, even
   * when the run failed or was stopped. Resolves to an error code when that fails, never rejects.
   */
  private async snapshotAfter(siteId: string, run: Run): Promise<string | undefined> {
    if (!run.cwd || !this.opts.changes.store.open(siteId)) return undefined;
    try {
      await this.opts.changes.snapshot(siteId, run.cwd);
      return undefined;
    } catch (err) {
      this.opts.logger.log("error", "agent.snapshot_failed", { sessionId: run.sessionId, error: String(err) });
      return runErrorCode(err);
    }
  }

  /** Whether the session's branch already has the reset note for change set `changeSetId`. */
  private hasResetNote(live: Live, changeSetId: string): boolean {
    return live.session.sessionManager
      .getBranch()
      .some(
        (e) =>
          e.type === "custom_message" &&
          e.customType === RESET_NOTE_TYPE &&
          (e.details as { changeSetId?: unknown } | undefined)?.changeSetId === changeSetId,
      );
  }

  /** Run a session's prompts; resolves to an error code, never rejects. */
  private async execute(run: Run, text: string): Promise<string | undefined> {
    const id = run.sessionId;
    let live: Live | null = null;
    try {
      // A session opened now already has the current model; one kept open may have an older one.
      const wasOpen = this.live.has(id);
      // Every run joins the site's open change set, or starts one (plan 7.2), before the AI touches files.
      const record = this.store.get(id);
      if (!record || run.cancelled || this.closing) return undefined;
      const joined = await this.opts.changes.begin(record.siteId, id);
      run.cwd = joined.cwd;
      live = await this.open(run);
      if (!live) return undefined;
      if (live.idleTimer) clearTimeout(live.idleTimer);
      live.idleTimer = null;
      if (wasOpen) await this.applyModel(live.session);
      this.store.touch(id);
      // The working copy was reset since this conversation last changed files (plan 6.2): tell the model
      // before the user's message, once per change set (a run that ended before sending it leaves no note,
      // and the next run sends it). Only the model sees it; the transcript shows message entries only.
      if (joined.previous && !this.hasResetNote(live, joined.change.id)) {
        await live.session.sendCustomMessage({
          customType: RESET_NOTE_TYPE,
          content: resetNote(joined.previous, joined.change.restoreCommit !== null),
          display: false,
          details: { changeSetId: joined.change.id },
        });
      }
      let prompt: string | undefined = text;
      while (prompt !== undefined && !run.cancelled) {
        await live.session.prompt(prompt);
        await live.session.waitForIdle();
        prompt = run.extra.length > 0 ? run.extra.splice(0).join("\n\n") : undefined;
      }
      return undefined;
    } catch (err) {
      this.opts.logger.log("error", "agent.run_failed", { sessionId: id, error: String(err) });
      return runErrorCode(err);
    } finally {
      if (live && this.live.get(id) === live) {
        if (this.store.get(id) && !this.closing) {
          this.store.touch(id);
          live.idleTimer = setTimeout(() => this.dispose(id), this.opts.idleMs ?? IDLE_MS);
          live.idleTimer.unref();
        } else {
          this.dispose(id);
        }
      }
    }
  }

  /**
   * The session's AgentSession, made from its file when not in memory (plan 6.2); null when the run was
   * cancelled or the session deleted meanwhile, so nothing is written for it.
   */
  private async open(run: Run): Promise<Live | null> {
    const id = run.sessionId;
    const gone = () => run.cancelled || this.closing || !this.store.get(id);
    if (gone()) return null;
    const existing = this.live.get(id);
    if (existing) return existing;
    const record = this.get(id);
    const site = this.opts.sites.get(record.siteId);
    const cwd = run.cwd;
    if (!cwd) throw new Error("open() before the run has a change set");
    const pi = await this.pi();
    const [modelRuntime, model] = await Promise.all([this.modelRuntime(), this.model()]);
    if (gone()) return null;
    const settingsManager = createSettings(pi);
    const piDir = this.opts.paths.pi;
    const resourceLoader = await createResourceLoader(pi, {
      cwd,
      piDir,
      settings: settingsManager,
      systemPrompt: buildSystemPrompt(site),
      skillsDir: this.opts.skillsDir,
      disabledSkills: this.opts.disabledSkills?.() ?? [],
    });
    // Skills are the one place outside the working copy the AI may read (plan 6.3). Only the enabled
    // skills' real directories are readable; a disabled skill cannot be read in a new conversation.
    const gate = new PathGate(
      cwd,
      skillReadRoots(resourceLoader.getSkills().skills, this.opts.skillsDir, (name, reason) =>
        this.opts.logger.log("warn", "agent.skill_read_root_skipped", { skill: name, reason }),
      ),
    );
    if (gone()) return null;
    const dir = this.sessionDir(site.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // open() starts a new session when the file does not exist yet, and keeps this path.
    const sessionManager = await this.openFile(record, cwd);
    const { session } = await pi.pi.createAgentSession({
      cwd,
      agentDir: piDir,
      modelRuntime,
      model,
      thinkingLevel: this.opts.thinkingLevel?.(),
      // An allowlist that the custom tools must be in too (plan 6.3).
      tools: [...BUILTIN_TOOLS, ...SITE_TOOLS],
      customTools: [
        ...createGatedTools(pi, { cwd, gate, rgReady: this.opts.rgReady }),
        ...createSiteTools({
          siteId: site.id,
          cwd,
          gate,
          bukit: this.opts.bukit,
          onSummary: (summary) => {
            this.opts.changes.setSummary(site.id, summary);
            this.emit({ siteId: site.id, sessionId: id, type: "summary", summary });
          },
        }),
      ],
      resourceLoader,
      sessionManager,
      settingsManager,
    });
    const unsubscribe = session.subscribe((event) => this.emit({ siteId: site.id, sessionId: id, type: "pi", event }));
    const live: Live = { siteId: site.id, session, unsubscribe, idleTimer: null };
    this.live.set(id, live);
    if (gone()) {
      this.dispose(id);
      return null;
    }
    return live;
  }

  private dispose(id: string): void {
    const live = this.live.get(id);
    if (!live) return;
    this.live.delete(id);
    if (live.idleTimer) clearTimeout(live.idleTimer);
    // This runs from an idle timer and during shutdown: a throw here must not take the process down.
    try {
      live.unsubscribe();
    } catch (err) {
      this.opts.logger.log("error", "agent.unsubscribe_failed", { sessionId: id, error: String(err) });
    }
    try {
      live.session.dispose();
    } catch (err) {
      this.opts.logger.log("error", "agent.dispose_failed", { sessionId: id, error: String(err) });
    }
  }
}

/** The error code a failed run reports in its idle status. */
function runErrorCode(err: unknown): string {
  return asSiteError(err)?.code ?? storageErrorCode(err) ?? "server.internal";
}
