import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../app.ts";
import type { EventHub } from "../events/hub.ts";

const PING_MS = 25_000;
/** A client this far behind is dropped; it reconnects and catches up from the replay buffer or resyncs. */
const MAX_QUEUED_BYTES = 4 * 1024 * 1024;
const RETRY_MS = 2000;

export interface EventStreamOptions {
  pingMs?: number;
  maxQueuedBytes?: number;
}

/** GET /api/events (plan 9.2): one stream per browser tab, every site's events on it. */
export function eventRoutes(api: Hono<AppEnv>, hub: EventHub, opts: EventStreamOptions = {}) {
  const maxQueued = opts.maxQueuedBytes ?? MAX_QUEUED_BYTES;
  api.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const queue: { id: string; data: string }[] = [];
      let queuedBytes = 0;
      let ended = false;
      let pingDue = false;
      let wake: (() => void) | null = null;
      const nudge = () => {
        const w = wake;
        wake = null;
        w?.();
      };
      const finish = () => {
        ended = true;
        nudge();
      };
      // Writes wait while the client reads nothing and swallow errors; aborting ends a write stuck there.
      const drop = () => {
        finish();
        stream.abort();
      };
      const sub = hub.subscribe(
        c.req.header("last-event-id"),
        (event) => {
          if (ended) return;
          const data = JSON.stringify(event);
          queue.push({ id: event.id, data });
          queuedBytes += data.length;
          if (queuedBytes > maxQueued) drop();
          else nudge();
        },
        drop,
      );
      stream.onAbort(finish);
      const ping = setInterval(() => {
        pingDue = true;
        nudge();
      }, opts.pingMs ?? PING_MS);
      try {
        // Sent before anything else, so the browser reconnects soon after a drop.
        await stream.write(`retry: ${RETRY_MS}\n\n`);
        for (const event of sub.backlog) await stream.writeSSE({ id: event.id, data: JSON.stringify(event) });
        while (!ended) {
          if (queue.length === 0 && !pingDue) await new Promise<void>((resolve) => (wake = resolve));
          if (ended) break;
          if (pingDue) {
            pingDue = false;
            await stream.write(": ping\n\n");
          }
          for (let next = queue.shift(); next && !ended; next = queue.shift()) {
            queuedBytes -= next.data.length;
            await stream.writeSSE(next);
          }
        }
      } finally {
        clearInterval(ping);
        sub.close();
      }
    }),
  );
}
