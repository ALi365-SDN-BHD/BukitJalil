import type { ChatMessage, ServerEvent } from "@bukitjalil/shared";
import { useSyncExternalStore } from "react";
import { applyEvent, emptyLive, type LiveSession, messageKey } from "./live";

const EMPTY = emptyLive();

/** Live state of every session the event stream has spoken about; components read it per session. */
export class LiveStore {
  private sessions = new Map<string, LiveSession>();
  private readonly listeners = new Set<() => void>();
  private pendingSeq = 0;
  /** Session ids are random and never reused, so this stays small. */
  private readonly deleted = new Set<string>();

  get(sessionId: string): LiveSession {
    return this.sessions.get(sessionId) ?? EMPTY;
  }

  apply(event: ServerEvent): void {
    if (!("sessionId" in event)) return;
    if (event.type === "session.deleted") {
      this.markDeleted(event.sessionId);
      return;
    }
    const before = this.get(event.sessionId);
    const after = applyEvent(before, event);
    if (after !== before) this.set(event.sessionId, after);
  }

  /** Drop live messages and tool progress that the fetched session already holds. */
  prune(sessionId: string, fetched: ChatMessage[]): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    const known = new Set(fetched.map(messageKey));
    const messages = state.messages.filter((m) => !known.has(messageKey(m)));
    const results = new Set(fetched.flatMap((m) => (m.role === "toolResult" ? [String(m.toolCallId)] : [])));
    const ids = Object.keys(state.tools);
    const kept = ids.filter((id) => !results.has(id));
    if (messages.length === state.messages.length && kept.length === ids.length) return;
    const tools = Object.fromEntries(kept.map((id) => [id, state.tools[id]]));
    this.set(sessionId, { ...state, messages, tools: tools as LiveSession["tools"] });
  }

  /**
   * A run ended in a session no view holds: its messages are fetched when it is opened, so only the
   * error of the run is worth keeping.
   */
  settle(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    if (state.error === null) this.forget(sessionId);
    else this.set(sessionId, { ...emptyLive(), error: state.error });
  }

  /** A message sent from this tab, shown until the session takes it in; returns its id. */
  addPending(sessionId: string, text: string): number {
    const id = ++this.pendingSeq;
    const state = this.get(sessionId);
    this.set(sessionId, { ...state, pending: [...state.pending, { id, text }] });
    return id;
  }

  removePending(sessionId: string, id: number): void {
    const state = this.sessions.get(sessionId);
    if (!state?.pending.some((p) => p.id === id)) return;
    this.set(sessionId, { ...state, pending: state.pending.filter((p) => p.id !== id) });
  }

  /** Deleted here or elsewhere: a view still showing it leaves, without fetching it again. */
  markDeleted(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.deleted.add(sessionId);
    this.notify();
  }

  isDeleted(sessionId: string): boolean {
    return this.deleted.has(sessionId);
  }

  forget(sessionId: string): void {
    if (this.sessions.delete(sessionId)) this.notify();
  }

  /** Forget everything (after a resync, everything is fetched again). */
  reset(): void {
    this.sessions = new Map();
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(sessionId: string, state: LiveSession): void {
    this.sessions.set(sessionId, state);
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const liveStore = new LiveStore();

export function useLive(sessionId: string): LiveSession {
  return useSyncExternalStore(liveStore.subscribe, () => liveStore.get(sessionId));
}

export function useDeleted(sessionId: string): boolean {
  return useSyncExternalStore(liveStore.subscribe, () => liveStore.isDeleted(sessionId));
}
