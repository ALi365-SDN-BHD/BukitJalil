import {
  type ContentProposalState,
  type ContentRef,
  type ProjectKey,
  parseContentKey,
  type ReferenceImageRequest,
  type SessionInfo,
  type SessionMessage,
  type SessionStatus,
  type SkillsResponse,
  type ThinkingLevel,
} from "@bukitjalil/shared";
import type { Api, ImageContent, Model } from "@earendil-works/pi-ai";
import type {
  AgentSession,
  AgentSessionEvent,
  ModelRuntime,
  SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ChangeService } from "../changes/service.ts";
import { notionId } from "../data-sources/service.ts";
import type { Logger } from "../log.ts";
import { cleanReferenceImage, type ReferenceImage, writeReferenceImages } from "../media/reference.ts";
import type { AppPaths } from "../paths.ts";
import { aiWriteScope, type ProjectService } from "../projects/service.ts";
import { asSiteError, SiteError } from "../sites/location.ts";
import type { SiteLocks } from "../sites/locks.ts";
import { storageErrorCode } from "../storage-errors.ts";
import type { Db } from "../store/db.ts";
import type { RenderChecker } from "../themes/render-check.ts";
import type { AiBukit } from "./ai-bukit.ts";
import type { ContentAgent } from "./content-agent.ts";
import { proposalIds, proposalIn } from "./content-proposals.ts";
import { PathGate } from "./gate.ts";
import { hasAuth } from "./models.ts";
import { loadPi, type PiModules } from "./pi.ts";
import { buildSystemPrompt, createModelRuntime, createResourceLoader, createSettings } from "./runtime.ts";
import type { SecretCredentialStore } from "./secret-credentials.ts";
import { createSiteTools, RENDER_TOOL, SITE_TOOLS, THEME_TOOLS } from "./site-tools.ts";
import { listSkills, skillReadRoots } from "./skills.ts";
import { isSessionId, newSessionId, type SessionRecord, SessionStore } from "./store.ts";
import { autoTitle } from "./title.ts";
import { BUILTIN_TOOLS, createGatedTools } from "./tools.ts";

const IDLE_MS = 10 * 60_000;
/** Longest shutdown waits for a model request that ignores abort. */
const SHUTDOWN_WAIT_MS = 10_000;

export type { SessionStatus };

/** What a session does, for the event stream: Pi's own events, status changes, and changes to the list. */
export type AgentEvent = { project: ProjectKey; sessionId: string } & (
  | { type: "pi"; event: AgentSessionEvent }
  | { type: "status"; status: SessionStatus; error?: string }
  /** summarize_changes: the AI's description of its changes, for the review (also kept with the change set). */
  | { type: "summary"; summary: string }
  /** The session was created, renamed or forked from another. */
  | { type: "session"; session: SessionInfo }
  | { type: "deleted" }
);

export interface AgentServiceOptions {
  db: Db;
  paths: AppPaths;
  projects: ProjectService;
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
  /** Model keys in the database (plan 6.9); Pi's auth.json is never used. */
  credentials: SecretCredentialStore;
  /** Called once on the new model runtime (tests register a fake provider). */
  setupRuntime?: (runtime: ModelRuntime, pi: PiModules) => void;
  /** BukitJalil's rg is installed and verified; grep is refused otherwise (plan 6.3). */
  rgReady: () => boolean;
  /** Bukit for the site tools: lock, snapshot and guard before each check or build. */
  bukit: AiBukit;
  /** The desktop app's render check for theme projects (taste skill D3); unset elsewhere. */
  renderCheck?: RenderChecker | null;
  /** BukitJalil's skills (plan 6.4): listed in the system prompt, readable but never writable by the AI. */
  skillsDir: string;
  /** Optional skills turned off in Settings; read before every session opens. */
  disabledSkills?: () => readonly string[];
  /**
   * Conversations of a Notion database (content editor and AI design, part 2), keyed `content/…`: no lock,
   * change set or files, only the content tools. Without it, such keys are refused.
   */
  content?: ContentAgent;
  /** Dispose an unused AgentSession after this long; its file stays (plan 6.2). */
  idleMs?: number;
  /** Longest shutdown waits for runs that ignore abort (tests set it short). */
  shutdownMs?: number;
}

interface Live {
  project: ProjectKey;
  session: AgentSession;
  unsubscribe: () => void;
  idleTimer: NodeJS.Timeout | null;
  /** Entries in the database, header included (plan 6.9). */
  saved: number;
}

/** A message from the user: its text and its checked reference images (theme development design 4.2). */
interface Message {
  text: string;
  images: ReferenceImage[];
  /** A content conversation's message: the entry open as it was sent (null: none). */
  entryId?: string | null;
}

interface Pending {
  sessionId: string;
  messages: Message[];
}

/** The run of one session; at most one per site. */
interface Run {
  sessionId: string;
  /** Set by stop, delete, site removal or shutdown: no further prompt is sent. */
  cancelled: boolean;
  /** Messages that arrived while the session was not streaming (opening, or between prompts). */
  extra: Message[];
  /** The AI checkout of the run's change set, once the run has one; snapshotted when the run ends. */
  cwd: string | null;
  /** Settles when the run has ended and touched nothing more. */
  done: Promise<void>;
}

/** customType of the note that tells the model its working copy was reset (plan 6.2). */
export const RESET_NOTE_TYPE = "bukitjalil.worktree_reset";
/** The note that tells a content conversation what the user decided on its proposals. */
export const PROPOSAL_NOTE_TYPE = "bukitjalil.proposal_decisions";

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
 * AI sessions (plan 6.2). A session is a row in `sessions` and its Pi entries in `session_entries` (plan
 * 6.9), held by an in-memory Pi session manager and saved as they are added; its AgentSession is made
 * when a message arrives and disposed after a while unused. One session per site runs at a time: messages
 * for other sessions of that site wait in order.
 */
export class AgentService {
  readonly store: SessionStore;
  private readonly live = new Map<string, Live>();
  private readonly pending = new Map<string, Pending[]>();
  /** project -> the run there. */
  private readonly running = new Map<string, Run>();
  /** Sites whose queued messages wait for another operation to free the site lock. */
  private readonly waiting = new Set<string>();
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private runtime: Promise<ModelRuntime> | null = null;
  private closing = false;

  constructor(private readonly opts: AgentServiceOptions) {
    this.store = new SessionStore(opts.db);
    opts.projects.onRemoving((project) => this.closeProject(project));
  }

  /** The model keys in the database (plan 6.9). */
  get credentials(): SecretCredentialStore {
    return this.opts.credentials;
  }

  /** Pi's own directory (models.json, device-id). */
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

  list(project: ProjectKey): SessionRecord[] {
    const content = this.contentOf(project);
    if (content) this.opts.content?.check(content);
    else this.opts.projects.get(project);
    return this.store.list(project);
  }

  /** Stop and dispose every conversation of a data source's databases, once the data source is removed. */
  async closeContentSource(sourceId: string): Promise<void> {
    const keys = new Set([
      ...this.pending.keys(),
      ...this.running.keys(),
      ...[...this.live.values()].map((l) => l.project),
    ]);
    await Promise.all(
      [...keys].filter((k) => parseContentKey(k)?.sourceId === sourceId).map((k) => this.closeProject(k)),
    );
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

  listInfo(project: ProjectKey): SessionInfo[] {
    return this.list(project).map((s) => this.toInfo(s));
  }

  /** A session of the site is running or has messages waiting: its change set is about to change. */
  busy(project: ProjectKey): boolean {
    return this.running.has(project) || (this.pending.get(project)?.length ?? 0) > 0;
  }

  private toInfo(record: SessionRecord): SessionInfo {
    const run = this.running.get(record.project);
    const queued = this.pending.get(record.project)?.some((p) => p.sessionId === record.id);
    return { ...record, status: run?.sessionId === record.id ? "running" : queued ? "queued" : "idle" };
  }

  /**
   * The messages of the session's current branch (plan 9.1), from its AgentSession when in memory (it
   * also has the messages of the run in progress), else from the database. A new session has none.
   */
  async messages(id: string): Promise<SessionMessage[]> {
    const record = this.get(id);
    const live = this.live.get(id);
    let entries: SessionEntry[];
    if (live) {
      entries = live.session.sessionManager.getBranch();
    } else {
      const manager = await this.openEntries(record);
      if (!manager) return [];
      entries = manager.getBranch();
    }
    // The system prompt is stored as a message too; it is not part of the conversation the user sees.
    return entries.flatMap((e) =>
      e.type === "message" && e.message.role !== "system" ? [{ entryId: e.id, message: e.message as never }] : [],
    );
  }

  /**
   * A new session with the path from the start to `entryId` of this one (plan 6.2). The source is read from
   * the database, where each entry is saved as Pi adds it, even while it runs; Pi's in-memory manager
   * replaces its entries with the branch, which is saved as the new session's.
   */
  async fork(id: string, entryId: string): Promise<SessionRecord> {
    this.assertOpen();
    const source = this.get(id);
    this.assertWritable(source.project);
    const manager = await this.openEntries(source);
    if (!manager?.getEntry(entryId)) throw new SiteError("session.entry_not_found", 404);
    this.assertOpen();
    const newId = newSessionId();
    manager.createBranchedSession(entryId);
    this.store.insert({ id: newId, project: source.project }, entriesOf(manager));
    if (source.title) this.store.rename(newId, source.title);
    return this.announce(newId);
  }

  /**
   * A session's saved entries in Pi's in-memory session manager, or null when nothing is saved yet (Pi keeps
   * a session only once it has a conversation). Entries Pi cannot read are reported as such.
   */
  private async openEntries(record: SessionRecord, cwd?: string): Promise<SessionManager | null> {
    const pi = await this.pi();
    try {
      const entries = this.store.entries(record.id);
      return entries.length === 0 ? null : pi.pi.SessionManager.inMemory(cwd, undefined, entries as never);
    } catch (err) {
      this.opts.logger.log("warn", "agent.session_unreadable", { sessionId: record.id, error: String(err) });
      throw new SiteError("session.unreadable", 409);
    }
  }

  /** Tell the event stream about a new or changed session. */
  private announce(id: string): SessionRecord {
    const record = this.get(id);
    this.emit({ project: record.project, sessionId: id, type: "session", session: this.toInfo(record) });
    return record;
  }

  /** Record a new session; its AgentSession and entries are made with the first message. */
  create(project: ProjectKey): SessionRecord {
    this.assertOpen();
    this.assertWritable(project);
    const id = newSessionId();
    this.store.insert({ id, project });
    return this.announce(id);
  }

  rename(id: string, title: string | null): SessionRecord {
    this.get(id);
    this.store.rename(id, title);
    return this.announce(id);
  }

  /** Stop the session and wait for its run to end, then delete its record and entries. */
  async delete(id: string): Promise<void> {
    const session = this.get(id);
    await this.stop(id);
    const run = this.running.get(session.project);
    if (run?.sessionId === id) await run.done;
    this.dispose(id);
    this.store.delete(id);
    this.emit({ project: session.project, sessionId: id, type: "deleted" });
  }

  /**
   * Send a message (plan 6.2). A running session gets it as a steering message, or after the current run
   * with `followUp`; if it is still opening, the message is sent once the current prompt ends. Otherwise
   * it waits for the site's running session, if any, then starts a run; messages sent while waiting are
   * joined into one. Resolves once the message is accepted. Images are checked and cleaned first, and refused
   * when the model cannot read them (theme development design 4.2).
   */
  async send(
    id: string,
    text: string,
    opts: { followUp?: boolean; images?: readonly ReferenceImageRequest[]; entryId?: string | null } = {},
  ): Promise<void> {
    this.assertOpen();
    const session = this.get(id);
    this.assertWritable(session.project);
    // Content conversations take no images: there is nowhere to keep them but the conversation.
    const content = this.contentOf(session.project) !== null;
    let entryId: string | null | undefined;
    if (content) {
      if ((opts.images?.length ?? 0) > 0) throw new SiteError("request.invalid_body", 400);
      entryId = opts.entryId ? notionId(opts.entryId) : null;
      if (opts.entryId && !entryId) throw new SiteError("request.invalid_body", 400);
    }
    // The entry goes with its message: the tools read it as "the open entry" once that message is taken in.
    const message: Message = {
      text,
      images: (opts.images ?? []).map(cleanReferenceImage),
      ...(content ? { entryId } : {}),
    };
    if (message.images.length > 0 && !(await this.model()).input.includes("image")) {
      throw new SiteError("image.model_unsupported", 400);
    }
    this.assertOpen();
    // The first message names the conversation; manual rename can still replace it later.
    if (!session.title) {
      const title = autoTitle(text);
      if (title) {
        this.store.rename(id, title);
        this.announce(id);
      }
    }
    const run = this.running.get(session.project);
    if (run?.sessionId === id && !run.cancelled) {
      const live = this.live.get(id);
      // A content follow-up waits for the next prompt, so the turn running now keeps its entry.
      if (live?.session.isStreaming && !(content && opts.followUp)) {
        const input = this.input(session.project, run.cwd, [message]);
        await (opts.followUp
          ? live.session.followUp(input.text, input.images)
          : live.session.steer(input.text, input.images));
        // A steering message joins the running turn, and so does its entry, once Pi has taken the message.
        if (content) this.opts.content?.setCurrent(id, entryId ?? null);
      } else {
        run.extra.push(message);
      }
      return;
    }
    // Fail now, not inside the queued run, when no model is set up.
    await this.model();
    this.assertOpen();
    const queue = this.pending.get(session.project) ?? [];
    this.pending.set(session.project, queue);
    const waiting = queue.find((p) => p.sessionId === id);
    if (waiting) waiting.messages.push(message);
    else queue.push({ sessionId: id, messages: [message] });
    if (this.running.has(session.project) || this.opts.locks.holder(session.project) !== null)
      this.emit({ project: session.project, sessionId: id, type: "status", status: "queued" });
    this.pump(session.project);
  }

  /** What became of each proposal in a content conversation (content editor and AI design, A2). */
  async proposals(id: string): Promise<ContentProposalState[]> {
    const { ref, content } = this.contentSession(id);
    return content.proposals.states(ref, proposalIds(await this.messages(id)));
  }

  /** Write a proposal of the conversation to Notion, as the user confirmed it. */
  async applyProposal(id: string, callId: string): Promise<ContentProposalState> {
    this.assertOpen();
    const { ref, content } = this.contentSession(id);
    const proposal = proposalIn(await this.messages(id), callId);
    if (!proposal) throw new SiteError("content.proposal_not_found", 404);
    content.check(ref);
    return content.proposals.apply(ref, id, callId, proposal);
  }

  async rejectProposal(id: string, callId: string): Promise<ContentProposalState> {
    this.assertOpen();
    const { ref, content } = this.contentSession(id);
    if (!proposalIn(await this.messages(id), callId)) throw new SiteError("content.proposal_not_found", 404);
    content.check(ref);
    return content.proposals.reject(ref, id, callId);
  }

  /** A content conversation's database and the content agent; 404 for any other session. */
  private contentSession(id: string): { ref: ContentRef; content: ContentAgent } {
    const record = this.get(id);
    const ref = this.contentOf(record.project);
    const content = this.opts.content;
    if (!ref || !content) throw new SiteError("session.not_found", 404);
    return { ref, content };
  }

  /** Stop a running session (plan 6.2), even one still opening, or drop its waiting messages. */
  async stop(id: string): Promise<void> {
    const session = this.get(id);
    this.dropPending(session.project, (p) => p.sessionId === id);
    const run = this.running.get(session.project);
    if (run?.sessionId === id) await this.cancel(run);
  }

  /** Stop every session of a site and wait for its run to end, before the site is removed. */
  async closeProject(project: ProjectKey): Promise<void> {
    this.dropPending(project, () => true);
    const run = this.running.get(project);
    if (run) {
      await this.cancel(run);
      await run.done;
    }
    for (const [id, live] of [...this.live]) if (live.project === project) this.dispose(id);
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

  /** The database of a content key, or null for a site or theme key; a content key without the agent is 404. */
  private contentOf(project: ProjectKey): ContentRef | null {
    const ref = parseContentKey(project);
    if (ref && !this.opts.content) throw new SiteError("session.not_found", 404);
    return ref;
  }

  /** The project can take new conversations and messages: a usable site or theme, or an existing data source. */
  private assertWritable(project: ProjectKey): void {
    const content = this.contentOf(project);
    if (content) this.opts.content?.check(content);
    else if (this.opts.projects.get(project).readOnly) throw new SiteError("site.read_only", 409);
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
  private dropPending(project: ProjectKey, match: (p: Pending) => boolean): void {
    const queue = this.pending.get(project) ?? [];
    for (const p of queue.filter(match)) this.emit({ project, sessionId: p.sessionId, type: "status", status: "idle" });
    this.pending.set(
      project,
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
  private pump(project: ProjectKey): void {
    if (this.running.has(project) || this.closing) return;
    if (!this.pending.get(project)?.length) return;
    let release: () => void;
    try {
      // A content conversation touches no repository: it needs no site lock.
      release = this.contentOf(project) ? () => {} : this.opts.locks.acquire(project, "session");
    } catch (err) {
      if (!(err instanceof SiteError) || err.code !== "site.busy") throw err;
      if (!this.waiting.has(project)) {
        this.waiting.add(project);
        void this.opts.locks.waitFree(project).then(() => {
          this.waiting.delete(project);
          this.pump(project);
        });
      }
      return;
    }
    const next = this.pending.get(project)?.shift();
    if (!next) {
      release();
      return;
    }
    const run: Run = { sessionId: next.sessionId, cancelled: false, extra: [], cwd: null, done: Promise.resolve() };
    this.running.set(project, run);
    const base = { project, sessionId: next.sessionId, type: "status" } as const;
    this.emit({ ...base, status: "running" });
    run.done = this.execute(run, next.messages)
      .then(async (error) => {
        // An aborted check or build may still be stopping Bukit: the lock stays until it has.
        if (this.contentOf(project)) return error;
        await this.opts.bukit.settled(project);
        return (await this.snapshotAfter(project, run)) ?? error;
      })
      // execute and snapshotAfter do not reject, but if anything in them does, the lock is still released.
      .catch((err: unknown) => runErrorCode(err))
      .then((error) => {
        this.running.delete(project);
        release();
        // Messages that arrived after the last prompt ended, while the run was still finishing (Bukit
        // stopping, the snapshot): they start the session's next run instead of being dropped. Not after a
        // failure: with no model or key, or a change set that could not open, the next run fails the same way.
        const requeued = run.extra.length > 0 && !error && !run.cancelled && !this.closing;
        if (requeued) this.requeue(project, run.sessionId, run.extra.splice(0));
        try {
          if (requeued) this.emit({ ...base, status: "queued" });
          else this.emit(error ? { ...base, status: "idle", error } : { ...base, status: "idle" });
          // Whether the change set can be reviewed depends on the run: say so even when no file changed.
          if (run.cwd) this.opts.changes.notify(project);
          this.pump(project);
        } catch (err) {
          this.opts.logger.log("error", "agent.after_run_failed", { sessionId: run.sessionId, error: String(err) });
        }
      });
  }

  /** Put messages first in line for `sessionId`, joined with any it already has waiting. */
  private requeue(project: ProjectKey, sessionId: string, messages: Message[]): void {
    const queue = this.pending.get(project) ?? [];
    this.pending.set(project, queue);
    const waiting = queue.find((p) => p.sessionId === sessionId);
    if (waiting) waiting.messages.unshift(...messages);
    else queue.unshift({ sessionId, messages });
  }

  /**
   * What to send Pi for messages: their texts joined, and their images. In a theme project the images are
   * also kept in the AI checkout's `_reference/` (design 4.2), so they reach the change set, and the text
   * names the files; a site keeps them only in the session file.
   */
  private input(project: ProjectKey, cwd: string | null, messages: readonly Message[]) {
    let text = messages.map((m) => m.text).join("\n\n");
    const images = messages.flatMap((m) => m.images);
    if (images.length === 0) return { text, images: undefined };
    if (cwd && this.opts.projects.get(project).themeName !== null) {
      const files = writeReferenceImages(cwd, images);
      text += `\n\n(The attached images are saved in the project as ${files.join(", ")}.)`;
    }
    const content: ImageContent[] = images.map((i) => ({
      type: "image",
      data: i.data.toString("base64"),
      mimeType: i.mimeType,
    }));
    return { text, images: content };
  }

  /**
   * After a run, still holding the lock: snapshot what the AI left in the checkout into the change set, even
   * when the run failed or was stopped. Resolves to an error code when that fails, never rejects.
   */
  private async snapshotAfter(project: ProjectKey, run: Run): Promise<string | undefined> {
    if (!run.cwd || !this.opts.changes.store.open(project)) return undefined;
    try {
      await this.opts.changes.snapshot(project, run.cwd);
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
  private async execute(run: Run, messages: Message[]): Promise<string | undefined> {
    const id = run.sessionId;
    let live: Live | null = null;
    try {
      // A session opened now already has the current model; one kept open may have an older one.
      const wasOpen = this.live.has(id);
      // Every run joins the site's open change set, or starts one (plan 7.2), before the AI touches files.
      const record = this.store.get(id);
      if (!record || run.cancelled || this.closing) return undefined;
      const joined = this.contentOf(record.project) ? null : await this.opts.changes.begin(record.project, id);
      if (joined) run.cwd = joined.cwd;
      live = await this.open(run);
      if (!live) return undefined;
      if (live.idleTimer) clearTimeout(live.idleTimer);
      live.idleTimer = null;
      if (wasOpen) await this.applyModel(live.session);
      this.store.touch(id);
      // The working copy was reset since this conversation last changed files (plan 6.2): tell the model
      // before the user's message, once per change set (a run that ended before sending it leaves no note,
      // and the next run sends it). Only the model sees it; the transcript shows message entries only.
      if (joined?.previous && !this.hasResetNote(live, joined.change.id)) {
        await live.session.sendCustomMessage({
          customType: RESET_NOTE_TYPE,
          content: resetNote(joined.previous, joined.change.restoreCommit !== null),
          display: false,
          details: { changeSetId: joined.change.id },
        });
      }
      const content = this.contentOf(record.project) !== null;
      let batch: Message[] = messages;
      while (batch.length > 0 && !run.cancelled) {
        // The user's decisions on proposals since the model last heard (content editor and AI design, A2),
        // before each prompt: a follow-up may come after a decision made while the last one ran.
        const notes = content ? this.opts.content?.proposals.notes(id) : null;
        if (notes) {
          await live.session.sendCustomMessage({
            customType: PROPOSAL_NOTE_TYPE,
            content: notes.text,
            display: false,
          });
          notes.ack();
        }
        // Joined messages: the latest one's entry is the open one.
        const sent = batch.findLast((m) => m.entryId !== undefined);
        if (sent) this.opts.content?.setCurrent(id, sent.entryId ?? null);
        const input = this.input(record.project, run.cwd, batch);
        await live.session.prompt(input.text, input.images ? { images: input.images } : undefined);
        await live.session.waitForIdle();
        batch = run.extra.splice(0);
      }
      return undefined;
    } catch (err) {
      this.opts.logger.log("error", "agent.run_failed", { sessionId: id, error: String(err) });
      return runErrorCode(err);
    } finally {
      if (live && this.live.get(id) === live) {
        this.save(id, live);
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
   * The session's AgentSession, made from its saved entries when not in memory (plan 6.2); null when the run was
   * cancelled or the session deleted meanwhile, so nothing is written for it.
   */
  private async open(run: Run): Promise<Live | null> {
    const id = run.sessionId;
    const gone = () => run.cancelled || this.closing || !this.store.get(id);
    if (gone()) return null;
    const existing = this.live.get(id);
    if (existing) return existing;
    const record = this.get(id);
    const content = this.contentOf(record.project);
    if (content) return this.openContent(run, record, content);
    const site = this.opts.projects.get(record.project);
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
      projectKind: site.ref.kind,
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
      aiWriteScope(site) ?? undefined,
    );
    if (gone()) return null;
    // A session with nothing saved yet starts a new Pi session.
    const sessionManager = (await this.openEntries(record, cwd)) ?? pi.pi.SessionManager.inMemory(cwd);
    const saved = sessionManager.getEntryCount() === 0 ? 0 : sessionManager.getEntryCount() + 1;
    const { session } = await pi.pi.createAgentSession({
      cwd,
      agentDir: piDir,
      modelRuntime,
      model,
      thinkingLevel: this.opts.thinkingLevel?.(),
      // An allowlist that the custom tools must be in too (plan 6.3).
      tools: [
        ...BUILTIN_TOOLS,
        ...SITE_TOOLS,
        ...(site.themeName === null ? [] : THEME_TOOLS),
        ...(site.themeName !== null && this.opts.renderCheck ? [RENDER_TOOL] : []),
      ],
      customTools: [
        ...createGatedTools(pi, { cwd, gate, rgReady: this.opts.rgReady }),
        ...createSiteTools({
          project: site.key,
          configFile: site.configFile,
          themeName: site.themeName,
          cwd,
          gate,
          bukit: this.opts.bukit,
          renderCheck: site.themeName === null ? null : (this.opts.renderCheck ?? null),
          onSummary: (summary) => {
            this.opts.changes.setSummary(site.key, summary);
            this.emit({ project: site.key, sessionId: id, type: "summary", summary });
          },
        }),
      ],
      resourceLoader,
      sessionManager,
      settingsManager,
    });
    return this.keep(run, site.key, session, saved);
  }

  /**
   * A content conversation's AgentSession (content editor and AI design, part 2): an empty working
   * directory, the content system prompt, no skills and only the content tools.
   */
  private async openContent(run: Run, record: SessionRecord, ref: ContentRef): Promise<Live | null> {
    const content = this.opts.content;
    if (!content) throw new SiteError("session.not_found", 404);
    const id = run.sessionId;
    const gone = () => run.cancelled || this.closing || !this.store.get(id);
    const pi = await this.pi();
    const [modelRuntime, model] = await Promise.all([this.modelRuntime(), this.model()]);
    if (gone()) return null;
    const cwd = content.cwd();
    const settingsManager = createSettings(pi);
    const piDir = this.opts.paths.pi;
    const resourceLoader = await createResourceLoader(pi, {
      cwd,
      piDir,
      settings: settingsManager,
      systemPrompt: content.systemPrompt(ref),
      projectKind: "site",
      skillsDir: null,
    });
    if (gone()) return null;
    const sessionManager = (await this.openEntries(record, cwd)) ?? pi.pi.SessionManager.inMemory(cwd);
    const saved = sessionManager.getEntryCount() === 0 ? 0 : sessionManager.getEntryCount() + 1;
    const customTools = content.tools(ref, { sessionId: id });
    const { session } = await pi.pi.createAgentSession({
      cwd,
      agentDir: piDir,
      modelRuntime,
      model,
      thinkingLevel: this.opts.thinkingLevel?.(),
      // Only the content tools: no files, commands or Bukit.
      tools: customTools.map((t) => t.name),
      customTools,
      resourceLoader,
      sessionManager,
      settingsManager,
    });
    return this.keep(run, record.project, session, saved);
  }

  /** Keep a new AgentSession in memory, saving and announcing its events; null if the run ended meanwhile. */
  private keep(run: Run, project: ProjectKey, session: AgentSession, saved: number): Live | null {
    const id = run.sessionId;
    const live: Live = { project, session, unsubscribe: () => {}, idleTimer: null, saved };
    live.unsubscribe = session.subscribe((event) => {
      // Saved as Pi adds entries (plan 6.9), before anyone hears of them.
      this.save(id, live);
      this.emit({ project, sessionId: id, type: "pi", event });
    });
    this.live.set(id, live);
    if (run.cancelled || this.closing || !this.store.get(id)) {
      this.dispose(id);
      return null;
    }
    return live;
  }

  /**
   * Save the entries Pi added since the last save (plan 6.9). Cheap when nothing changed, so it runs on every
   * event. A failure is logged and tried again at the next event; it must not stop the run, nor dispose().
   */
  private save(id: string, live: Live): void {
    try {
      const manager = live.session.sessionManager;
      const count = manager.getEntryCount();
      if (count === 0 || count + 1 === live.saved || !this.store.get(id)) return;
      live.saved = this.store.saveEntries(id, entriesOf(manager));
    } catch (err) {
      this.opts.logger.log("error", "agent.session_save_failed", { sessionId: id, error: String(err) });
    }
  }

  private dispose(id: string): void {
    const live = this.live.get(id);
    if (!live) return;
    this.live.delete(id);
    if (live.idleTimer) clearTimeout(live.idleTimer);
    // A content conversation's open entry is set again with its next message.
    this.opts.content?.forget(id);
    this.save(id, live);
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

/** What is saved of a Pi session: its header, then its entries in order. */
function entriesOf(manager: SessionManager): unknown[] {
  return [manager.getHeader(), ...manager.getEntries()];
}

/** The error code a failed run reports in its idle status. */
function runErrorCode(err: unknown): string {
  return asSiteError(err)?.code ?? storageErrorCode(err) ?? "server.internal";
}
