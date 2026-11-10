import crypto from "node:crypto";
import type { ServerEvent, ServerEventInput } from "@bukitjalil/shared";

export const REPLAY_MAX_BYTES = 1024 * 1024;
/** Rough size of an event's fields besides a delta's text, for the buffer limit. */
const DELTA_OVERHEAD = 160;

interface Buffered {
  seq: number;
  event: ServerEvent;
  bytes: number;
}

/** The streamed text of a session's current message so far, kept as chunks so appending stays cheap. */
interface Delta {
  seq: number;
  siteId: string;
  sessionId: string;
  chunks: string[];
  length: number;
  bytes: number;
}

export interface Subscriber {
  /** Events to send before anything else: missed ones, a resync, or the text of replies in progress. */
  backlog: ServerEvent[];
  close(): void;
}

/**
 * The event stream behind GET /api/events (plan 9.2). Every event gets an id `<epoch>-<seq>`; the epoch
 * changes with each server start, so an id from before a restart is recognised as unknown.
 *
 * A replay buffer of at most `maxBytes` serves reconnects with Last-Event-ID. Text deltas of a session's
 * current message are kept as one entry with the text so far (sent as offset 0 with the newest delta's
 * id), and dropped once the message ends, since `message.end` carries the whole message. When an event
 * the client missed has left the buffer, or the id is unknown, the client gets `resync` and refetches
 * what it shows. A new connection gets the text of replies in progress, which no API returns. `change`
 * events carry a site's whole change set state, so only each site's newest one is kept.
 */
export class EventHub {
  private readonly epoch = crypto.randomBytes(4).toString("hex");
  private seq = 0;
  /** Events other than deltas, oldest first. */
  private buffer: Buffered[] = [];
  /** sessionId -> its current message's text. */
  private readonly deltas = new Map<string, Delta>();
  private bytes = 0;
  /** Highest seq dropped for size: a client that last saw an earlier event has missed something. */
  private evictedUpTo = 0;
  /** send -> end, for each open stream. */
  private readonly subscribers = new Map<(event: ServerEvent) => void, () => void>();

  constructor(private readonly maxBytes = REPLAY_MAX_BYTES) {}

  publish(input: ServerEventInput): ServerEvent {
    const seq = ++this.seq;
    const event = { ...input, id: this.id(seq) } as ServerEvent;
    this.remember(seq, event);
    for (const send of this.subscribers.keys()) send(event);
    return event;
  }

  /**
   * Start receiving events. `lastEventId` is the browser's Last-Event-ID: missed events come back in
   * `backlog`. Without one, the backlog is the text of replies still streaming (the client loads the rest
   * of its state itself).
   */
  subscribe(lastEventId: string | undefined, send: (event: ServerEvent) => void, end: () => void): Subscriber {
    const backlog = lastEventId === undefined ? this.replay(0, false) : this.since(lastEventId);
    this.subscribers.set(send, end);
    return { backlog, close: () => this.subscribers.delete(send) };
  }

  /** End every open stream (server shutdown). */
  closeAll(): void {
    const ends = [...this.subscribers.values()];
    this.subscribers.clear();
    for (const end of ends) end();
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  private id(seq: number): string {
    return `${this.epoch}-${seq}`;
  }

  private since(lastEventId: string): ServerEvent[] {
    const match = /^([0-9a-f]{8})-(\d{1,15})$/.exec(lastEventId);
    const last = match?.[1] === this.epoch ? Number(match[2]) : Number.NaN;
    if (!(last <= this.seq) || last < this.evictedUpTo) {
      return [{ id: this.id(this.seq), type: "resync", data: {} }];
    }
    return this.replay(last, true);
  }

  /** Kept events after `last` in order, deltas as their text so far; `all` false: deltas only. */
  private replay(last: number, all: boolean): ServerEvent[] {
    const out: { seq: number; event: ServerEvent }[] = [];
    if (all) for (const b of this.buffer) if (b.seq > last) out.push(b);
    for (const d of this.deltas.values()) {
      if (d.seq <= last) continue;
      const text = d.chunks.join("");
      d.chunks = [text];
      out.push({
        seq: d.seq,
        event: {
          id: this.id(d.seq),
          type: "message.delta",
          siteId: d.siteId,
          sessionId: d.sessionId,
          data: { offset: 0, text },
        },
      });
    }
    return out.sort((a, b) => a.seq - b.seq).map((x) => x.event);
  }

  private remember(seq: number, event: ServerEvent): void {
    if (event.type === "resync") return;
    if (event.type === "message.delta") {
      const { offset, text } = event.data;
      const d = this.deltas.get(event.sessionId);
      if (d && offset === d.length) {
        // The usual case: the next piece of the same text.
        d.chunks.push(text);
        d.length += text.length;
        d.seq = seq;
        this.resize(d, d.length + DELTA_OVERHEAD);
      } else if (d && offset > 0 && offset < d.length) {
        const kept = d.chunks.join("").slice(0, offset) + text;
        d.chunks = [kept];
        d.length = kept.length;
        d.seq = seq;
        this.resize(d, d.length + DELTA_OVERHEAD);
      } else if (offset === 0) {
        if (d) this.dropDelta(d);
        const fresh: Delta = {
          seq,
          siteId: event.siteId,
          sessionId: event.sessionId,
          chunks: [text],
          length: text.length,
          bytes: 0,
        };
        this.deltas.set(event.sessionId, fresh);
        this.resize(fresh, text.length + DELTA_OVERHEAD);
      } else {
        // Its earlier text is gone (dropped for size): a client that missed it resyncs instead.
        if (d) this.dropDelta(d);
        this.evictedUpTo = Math.max(this.evictedUpTo, seq);
      }
      this.trim();
      return;
    }
    if (event.type === "message.end") {
      const d = this.deltas.get(event.sessionId);
      if (d) this.dropDelta(d);
    }
    if (event.type === "change") {
      // Each one is the site's whole change set state, so only the newest is worth replaying.
      const i = this.buffer.findIndex((b) => b.event.type === "change" && b.event.siteId === event.siteId);
      if (i >= 0) {
        this.bytes -= this.buffer[i]?.bytes ?? 0;
        this.buffer.splice(i, 1);
      }
    }
    const bytes = Buffer.byteLength(JSON.stringify(event));
    this.buffer.push({ seq, event, bytes });
    this.bytes += bytes;
    this.trim();
  }

  private resize(d: Delta, bytes: number): void {
    this.bytes += bytes - d.bytes;
    d.bytes = bytes;
  }

  private dropDelta(d: Delta): void {
    this.deltas.delete(d.sessionId);
    this.bytes -= d.bytes;
  }

  /** Drop the oldest entries until the buffer fits. */
  private trim(): void {
    while (this.bytes > this.maxBytes) {
      const oldest = this.buffer[0];
      let oldestDelta: Delta | undefined;
      for (const d of this.deltas.values()) if (!oldestDelta || d.seq < oldestDelta.seq) oldestDelta = d;
      if (oldestDelta && (!oldest || oldestDelta.seq < oldest.seq)) {
        this.evictedUpTo = Math.max(this.evictedUpTo, oldestDelta.seq);
        this.dropDelta(oldestDelta);
      } else if (oldest) {
        this.evictedUpTo = Math.max(this.evictedUpTo, oldest.seq);
        this.buffer.shift();
        this.bytes -= oldest.bytes;
      } else {
        break;
      }
    }
  }
}
