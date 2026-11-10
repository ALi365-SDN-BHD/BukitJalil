import type { ChangeView, ServerEvent } from "@bukitjalil/shared";
import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentService } from "../src/agent/service.ts";
import type { BuildEvent, BuildService } from "../src/builds/service.ts";
import type { ChangeService } from "../src/changes/service.ts";
import { agentEventTranslator, changeRefresher, connectEvents } from "../src/events/bridge.ts";
import { EventHub } from "../src/events/hub.ts";
import { silentLogger } from "../src/log.ts";

const S = { siteId: "site1", sessionId: "aaaaaaaaaaaaaaaa" };
const status = (s: "idle" | "running") => ({ ...S, type: "session.status", data: { status: s } }) as const;
const delta = (offset: number, text: string, sessionId = S.sessionId) =>
  ({ ...S, sessionId, type: "message.delta", data: { offset, text } }) as const;
const end = (text: string) =>
  ({ ...S, type: "message.end", data: { message: { role: "assistant", content: [{ type: "text", text }] } } }) as const;

/** A subscriber that collects what it is sent. */
function listen(hub: EventHub, lastId?: string) {
  const got: ServerEvent[] = [];
  let ended = false;
  const sub = hub.subscribe(
    lastId,
    (e) => got.push(e),
    () => {
      ended = true;
    },
  );
  return { sub, got, ended: () => ended };
}

describe("EventHub", () => {
  it("numbers events within this server's epoch and sends them to every subscriber", () => {
    const hub = new EventHub();
    const a = listen(hub);
    const b = listen(hub);
    const first = hub.publish(status("running"));
    const second = hub.publish(status("idle"));
    expect(first.id).toMatch(/^[0-9a-f]{8}-1$/);
    expect(second.id).toBe(first.id.replace(/-1$/, "-2"));
    expect(a.got).toEqual([first, second]);
    expect(b.got).toEqual([first, second]);
    // A fresh connection loads its state itself: no backlog.
    expect(a.sub.backlog).toEqual([]);
    a.sub.close();
    hub.publish(status("running"));
    expect(a.got).toHaveLength(2);
    expect(b.got).toHaveLength(3);
  });

  it("replays what a reconnecting client missed", () => {
    const hub = new EventHub();
    const first = hub.publish(status("running"));
    const second = hub.publish(status("idle"));
    const third = hub.publish(status("running"));
    expect(listen(hub, first.id).sub.backlog).toEqual([second, third]);
    expect(listen(hub, third.id).sub.backlog).toEqual([]);
  });

  it("asks for a resync when the id is unknown: another epoch, ahead, or not an id", () => {
    const hub = new EventHub();
    const first = hub.publish(status("running"));
    const other = new EventHub().publish(status("running"));
    for (const id of [other.id, first.id.replace(/-1$/, "-9"), "nonsense", ""]) {
      const backlog = listen(hub, id).sub.backlog;
      expect(
        backlog.map((e) => e.type),
        id,
      ).toEqual(["resync"]);
      // Its id is the newest, so the next reconnect starts from here.
      expect(backlog[0]?.id).toBe(first.id);
    }
  });

  it("merges the deltas of a message into its text so far, and drops them when it ends", () => {
    const hub = new EventHub();
    const start = hub.publish(status("running"));
    hub.publish(delta(0, "Hel"));
    const d2 = hub.publish(delta(3, "lo"));
    hub.publish(delta(0, "other", "bbbbbbbbbbbbbbbb"));
    const d3 = hub.publish(delta(5, " world"));
    const backlog = listen(hub, start.id).sub.backlog;
    expect(backlog.map((e) => e.data)).toEqual([
      { offset: 0, text: "other" },
      { offset: 0, text: "Hello world" },
    ]);
    // The merged entry has the newest id: a client that saw d2 gets the whole text, which replaces its own.
    expect(listen(hub, d2.id).sub.backlog.map((e) => e.data)).toEqual([
      { offset: 0, text: "other" },
      { offset: 0, text: "Hello world" },
    ]);
    expect(listen(hub, d3.id).sub.backlog).toEqual([]);
    const done = hub.publish(end("Hello world"));
    expect(listen(hub, start.id).sub.backlog.map((e) => e.type)).toEqual(["message.delta", "message.end"]);
    expect(listen(hub, start.id).sub.backlog[1]).toEqual(done);
  });

  it("gives a new connection the text of replies still streaming", () => {
    const hub = new EventHub();
    hub.publish(status("running"));
    hub.publish(delta(0, "Hel"));
    const last = hub.publish(delta(3, "lo"));
    hub.publish(delta(0, "done", "bbbbbbbbbbbbbbbb"));
    hub.publish({ ...end("done"), sessionId: "bbbbbbbbbbbbbbbb" });
    const backlog = listen(hub).sub.backlog;
    expect(backlog).toEqual([{ ...delta(0, "Hello"), id: last.id }]);
    // A later delta continues from there.
    const next = hub.publish(delta(5, "!"));
    expect(next.data).toEqual({ offset: 5, text: "!" });
    expect(listen(hub).sub.backlog.map((e) => e.data)).toEqual([{ offset: 0, text: "Hello!" }]);
  });

  it("cuts the text back when a delta rewrites part of it", () => {
    const hub = new EventHub();
    const start = hub.publish(status("running"));
    hub.publish(delta(0, "Hello world"));
    hub.publish(delta(5, ", you"));
    expect(listen(hub, start.id).sub.backlog.map((e) => e.data)).toEqual([{ offset: 0, text: "Hello, you" }]);
  });

  it("drops a long reply's text for size like any other event", () => {
    const hub = new EventHub(4000);
    const start = hub.publish(status("running"));
    let offset = 0;
    for (let i = 0; i < 100; i++) {
      hub.publish(delta(offset, "x".repeat(50)));
      offset += 50;
    }
    // 5,000 characters do not fit: the text is gone, and a client that saw only part of it resyncs.
    expect(listen(hub, start.id).sub.backlog.map((e) => e.type)).toEqual(["resync"]);
    expect(listen(hub).sub.backlog).toEqual([]);
    // The next piece cannot be merged onto missing text, so it is not kept either.
    const late = hub.publish(delta(offset, "y"));
    expect(
      listen(
        hub,
        late.id.replace(/\d+$/, (n) => String(Number(n) - 1)),
      ).sub.backlog.map((e) => e.type),
    ).toEqual(["resync"]);
  });

  it("keeps at most the byte limit, and resyncs a client that missed a dropped event", () => {
    const hub = new EventHub(2000);
    const ids = Array.from(
      { length: 20 },
      (_, i) => hub.publish({ ...S, type: "session.summary", data: { summary: `${i}`.repeat(200) } }).id,
    );
    const newest = ids.at(-1) as string;
    const kept = listen(hub, ids[0]).sub.backlog;
    expect(kept.map((e) => e.type)).toEqual(["resync"]);
    // A client that is only a little behind still gets a plain replay.
    const recent = listen(hub, ids.at(-3)).sub.backlog;
    expect(recent.map((e) => e.id)).toEqual(ids.slice(-2));
    expect(listen(hub, newest).sub.backlog).toEqual([]);
  });

  it("ends every stream on closeAll", () => {
    const hub = new EventHub();
    const a = listen(hub);
    hub.closeAll();
    expect(a.ended()).toBe(true);
    expect(hub.subscriberCount).toBe(0);
  });
});

describe("agent events on the stream", () => {
  const pi = (event: unknown): AgentEvent => ({ ...S, type: "pi", event: event as never });
  const assistant = { role: "assistant", content: [] };

  it("turns text deltas into offsets within the current assistant message", () => {
    const t = agentEventTranslator();
    const out = [
      pi({ type: "message_start", message: { role: "user" } }),
      pi({ type: "message_start", message: assistant }),
      pi({ type: "message_update", message: assistant, assistantMessageEvent: { type: "text_delta", delta: "Hi" } }),
      pi({
        type: "message_update",
        message: assistant,
        assistantMessageEvent: { type: "thinking_delta", delta: "hm" },
      }),
      pi({
        type: "message_update",
        message: assistant,
        assistantMessageEvent: { type: "text_delta", delta: " there" },
      }),
      pi({ type: "message_end", message: assistant }),
      pi({ type: "message_start", message: assistant }),
      pi({ type: "message_update", message: assistant, assistantMessageEvent: { type: "text_delta", delta: "Again" } }),
    ].flatMap(t);
    expect(out.map((e) => [e.type, e.data])).toEqual([
      ["message.delta", { offset: 0, text: "Hi" }],
      ["message.delta", { offset: 2, text: " there" }],
      ["message.end", { message: assistant }],
      ["message.delta", { offset: 0, text: "Again" }],
    ]);
  });

  it("passes statuses, tools, settled runs, summaries and list changes; drops the rest", () => {
    const t = agentEventTranslator();
    const info = {
      id: S.sessionId,
      siteId: S.siteId,
      title: null,
      createdAt: "t",
      updatedAt: "t",
      status: "idle",
    } as const;
    const out = [
      { ...S, type: "status", status: "running" } as AgentEvent,
      pi({ type: "turn_start" }),
      pi({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { path: "a" } }),
      pi({ type: "tool_execution_update", toolCallId: "c1", toolName: "read", args: {}, partialResult: "p" }),
      pi({ type: "tool_execution_end", toolCallId: "c1", toolName: "read", result: "r", isError: false }),
      pi({ type: "queue_update", steering: [], followUp: [] }),
      { ...S, type: "summary", summary: "Did it." } as AgentEvent,
      { ...S, type: "session", session: info } as AgentEvent,
      { ...S, type: "deleted" } as AgentEvent,
      pi({ type: "agent_settled", aborted: true }),
      { ...S, type: "status", status: "idle", error: "agent.no_model" } as AgentEvent,
    ].flatMap(t);
    expect(out).toEqual([
      { ...S, type: "session.status", data: { status: "running" } },
      { ...S, type: "tool.start", data: { toolCallId: "c1", toolName: "read", args: { path: "a" } } },
      { ...S, type: "tool.update", data: { toolCallId: "c1", toolName: "read", partialResult: "p" } },
      { ...S, type: "tool.end", data: { toolCallId: "c1", toolName: "read", result: "r", isError: false } },
      { ...S, type: "session.summary", data: { summary: "Did it." } },
      { ...S, type: "session.updated", data: { session: info } },
      { ...S, type: "session.deleted", data: {} },
      { ...S, type: "run.settled", data: { aborted: true } },
      { ...S, type: "session.status", data: { status: "idle", error: "agent.no_model" } },
    ]);
  });

  it("sends build starts and ends for the build's site", () => {
    const hub = new EventHub();
    const got = listen(hub).got;
    let agentListener: ((e: AgentEvent) => void) | undefined;
    let buildListener: ((e: BuildEvent) => void) | undefined;
    const agent = {
      subscribe: (l: (e: AgentEvent) => void) => {
        agentListener = l;
        return () => {};
      },
      busy: () => false,
    };
    const builds = {
      onEvent: (l: (e: BuildEvent) => void) => {
        buildListener = l;
        return () => {};
      },
    };
    const changes = { subscribe: () => () => {}, current: async () => null };
    connectEvents(hub, {
      agent: agent as unknown as AgentService,
      builds: builds as unknown as BuildService,
      changes: changes as unknown as ChangeService,
      logger: silentLogger,
    });
    const build = { id: "b1", siteId: "site9" } as BuildEvent["build"];
    buildListener?.({ type: "build.start", build });
    agentListener?.({ ...S, type: "status", status: "running" });
    expect(got.map(({ id: _, ...e }) => e)).toEqual([
      { type: "build.start", siteId: "site9", data: { build } },
      { ...S, type: "session.status", data: { status: "running" } },
    ]);
  });
});

describe("change set events", () => {
  const view = (id: string) => ({ id }) as ChangeView;

  it("keeps only each site's newest change event for reconnects", () => {
    const hub = new EventHub();
    const first = hub.publish({ type: "change", siteId: "a", data: { change: view("1") } });
    hub.publish({ type: "change", siteId: "b", data: { change: view("2") } });
    hub.publish({ type: "change", siteId: "a", data: { change: null } });
    const replay = listen(hub, first.id).sub.backlog.map((e) =>
      e.type === "change" ? [e.siteId, e.data.change] : e.type,
    );
    expect(replay).toEqual([
      ["b", { id: "2" }],
      ["a", null],
    ]);
    // Superseded events are not "missed": a client that saw the first one gets no resync.
    expect(listen(hub, first.id).sub.backlog.some((e) => e.type === "resync")).toBe(false);
  });

  it("reads one site at a time, in order, and skips states already sent", async () => {
    const hub = new EventHub();
    const { got } = listen(hub);
    let state: ChangeView | null = view("1");
    const gates: (() => void)[] = [];
    let reads = 0;
    const changes = {
      current: async () => {
        reads++;
        const seen = state;
        await new Promise<void>((resolve) => gates.push(resolve));
        return seen;
      },
    };
    const refresh = changeRefresher(hub, { busy: () => false }, changes, silentLogger);
    refresh("a");
    // Changes during a read cause one more read, not one per change.
    state = view("2");
    refresh("a");
    refresh("a");
    expect(reads).toBe(1);
    gates.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(reads).toBe(2);
    gates.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
    refresh("a");
    gates.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(reads).toBe(3);
    expect(got.map((e) => (e.type === "change" ? e.data.change?.id : e.type))).toEqual(["1", "2"]);
  });
});
