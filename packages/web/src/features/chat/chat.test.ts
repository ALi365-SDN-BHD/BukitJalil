import type { ChatMessage, ServerEvent, ServerEventInput, SessionDetail, SessionInfo } from "@bukitjalil/shared";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { keys } from "@/lib/api";
import { handleEvent } from "@/lib/events";
import { applyEvent, emptyLive, unseen } from "./live";
import { chatItems, latestSummary, mergeMessages, resultText, tailSignature, toolTarget } from "./model";
import { liveStore } from "./store";

const S = { siteId: "site1", sessionId: "aaaaaaaaaaaaaaaa" };
let seq = 0;
const ev = (e: ServerEventInput) => ({ ...e, id: `e-${++seq}` }) as ServerEvent;
const status = (s: SessionInfo["status"], error?: string) =>
  ev({ ...S, type: "session.status", data: error ? { status: s, error } : { status: s } } as never);
const delta = (offset: number, text: string) => ev({ ...S, type: "message.delta", data: { offset, text } } as never);
const user = (text: string, timestamp = 1): ChatMessage => ({ role: "user", content: text, timestamp });
const assistant = (content: unknown[], extra: Record<string, unknown> = {}): ChatMessage => ({
  role: "assistant",
  content,
  timestamp: 2,
  ...extra,
});
const end = (message: ChatMessage) => ev({ ...S, type: "message.end", data: { message } } as never);
const info = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  id: S.sessionId,
  siteId: S.siteId,
  title: null,
  createdAt: "t",
  updatedAt: "t",
  status: "idle",
  ...over,
});

describe("live session state", () => {
  it("builds the streamed text from offsets and clears it when the message ends", () => {
    let s = emptyLive();
    s = applyEvent(s, status("running"));
    s = applyEvent(s, delta(0, "Hel"));
    s = applyEvent(s, delta(3, "lo"));
    expect(s.text).toBe("Hello");
    // A replay replaces the text so far; a delta past it is dropped.
    s = applyEvent(s, delta(0, "Hello wor"));
    s = applyEvent(s, delta(20, "??"));
    expect(s.text).toBe("Hello wor");
    const done = assistant([{ type: "text", text: "Hello world" }]);
    s = applyEvent(s, end(done));
    expect(s.text).toBeNull();
    expect(s.messages).toEqual([done]);
  });

  it("follows tools and how the run ended", () => {
    let s = applyEvent(emptyLive(), status("running"));
    s = applyEvent(
      s,
      ev({ ...S, type: "tool.start", data: { toolCallId: "c1", toolName: "read", args: { path: "a" } } }),
    );
    s = applyEvent(
      s,
      ev({ ...S, type: "tool.update", data: { toolCallId: "c1", toolName: "read", partialResult: "p" } }),
    );
    expect(s.tools.c1).toMatchObject({ name: "read", partial: "p", done: false });
    s = applyEvent(
      s,
      ev({ ...S, type: "tool.end", data: { toolCallId: "c1", toolName: "read", result: "r", isError: true } }),
    );
    expect(s.tools.c1).toMatchObject({ args: { path: "a" }, result: "r", isError: true, done: true });
    s = applyEvent(s, status("idle", "agent.no_model"));
    expect(s).toMatchObject({ error: "agent.no_model", text: null });
    // The next run clears the error.
    expect(applyEvent(s, status("running")).error).toBeNull();
  });

  it("shows a sent message as waiting until the session takes it in", () => {
    liveStore.reset();
    const first = liveStore.addPending(S.sessionId, "one");
    liveStore.addPending(S.sessionId, "two");
    liveStore.addPending(S.sessionId, "three");
    expect(liveStore.get(S.sessionId).pending.map((p) => p.text)).toEqual(["one", "two", "three"]);
    // Pi stores the prompt as text blocks; the first waiting message with the same text goes.
    liveStore.apply(end({ role: "user", content: [{ type: "text", text: "two" }], timestamp: 3 }));
    liveStore.apply(status("queued"));
    expect(liveStore.get(S.sessionId).pending.map((p) => p.text)).toEqual(["one", "three"]);
    liveStore.removePending(S.sessionId, first);
    expect(liveStore.get(S.sessionId).pending.map((p) => p.text)).toEqual(["three"]);
    // Idle: the run ended or the waiting messages were dropped.
    liveStore.apply(status("idle"));
    expect(liveStore.get(S.sessionId).pending).toEqual([]);
  });

  it("drops live messages and tool progress the stored session already has", () => {
    liveStore.reset();
    const b = assistant([], { timestamp: 5 });
    liveStore.apply(end(b));
    liveStore.apply(ev({ ...S, type: "tool.start", data: { toolCallId: "c1", toolName: "read", args: {} } }));
    liveStore.apply(ev({ ...S, type: "tool.start", data: { toolCallId: "c2", toolName: "read", args: {} } }));
    liveStore.prune(S.sessionId, [b, { role: "toolResult", toolCallId: "c1", content: [], timestamp: 6 }]);
    expect(liveStore.get(S.sessionId).messages).toEqual([]);
    expect(Object.keys(liveStore.get(S.sessionId).tools)).toEqual(["c2"]);
  });

  it("drops live messages the stored session already has", () => {
    const a = user("a", 1);
    const b = assistant([], { timestamp: 5 });
    expect(unseen([a, b], [a])).toEqual([b]);
  });
});

describe("chat items", () => {
  const call = (id: string, name: string, args: unknown) => ({ type: "toolCall", id, name, arguments: args });

  it("joins tool calls to their results and hides result messages", () => {
    const messages = mergeMessages(
      [
        { entryId: "e1", message: user("make a page") },
        {
          entryId: "e2",
          message: assistant([
            { type: "thinking", thinking: "plan" },
            { type: "text", text: "Writing it." },
            call("c1", "write", { path: "content/a.md", content: "# A" }),
            call("c2", "bukit_check", {}),
          ]),
        },
        {
          entryId: "e3",
          message: {
            role: "toolResult",
            toolCallId: "c1",
            toolName: "write",
            content: [{ type: "text", text: "ok" }],
            isError: false,
          },
        },
      ],
      [],
    );
    const items = chatItems(messages, { tools: {}, running: true });
    expect(items.map((i) => i.kind)).toEqual(["user", "assistant"]);
    const parts = items[1]?.kind === "assistant" ? items[1].parts : [];
    expect(parts.map((p) => p.kind)).toEqual(["thinking", "text", "tool", "tool"]);
    expect(parts[2]).toMatchObject({ tool: { name: "write", state: "ok", output: "ok" } });
    // No result yet while the run goes on: running; after it, not run.
    expect(parts[3]).toMatchObject({ tool: { name: "bukit_check", state: "running" } });
    const after = chatItems(messages, { tools: {}, running: false });
    expect(after[1]?.kind === "assistant" && after[1].parts[3]).toMatchObject({ tool: { state: "not_run" } });
  });

  it("uses live tool progress until the result message arrives, and marks errors and stops", () => {
    const messages = mergeMessages([], [assistant([call("c1", "grep", { pattern: "x" })], { stopReason: "aborted" })]);
    const live = {
      c1: {
        name: "grep",
        args: {},
        partial: null,
        result: { content: [{ type: "text", text: "no rg" }] },
        isError: true,
        done: true,
      },
    };
    const [item] = chatItems(messages, { tools: live, running: true });
    expect(item).toMatchObject({ kind: "assistant", entryId: null, aborted: true });
    expect(item?.kind === "assistant" && item.parts[0]).toMatchObject({ tool: { state: "error", output: "no rg" } });
    const failed = chatItems(mergeMessages([], [assistant([], { stopReason: "error", errorMessage: "401" })]), {
      tools: {},
      running: false,
    });
    expect(failed[0]).toMatchObject({ error: "401" });
  });

  it("takes the summary from the latest run only", () => {
    const summarize = (id: string, summary: string) => call(id, "summarize_changes", { summary });
    const result = (id: string, isError = false): ChatMessage => ({
      role: "toolResult",
      toolCallId: id,
      content: [{ type: "text", text: "Saved." }],
      isError,
    });
    const at = (n: number, message: ChatMessage) => ({ entryId: `e${n}`, message });
    const run1 = [
      at(1, user("first")),
      at(2, assistant([summarize("s1", " Changed the title ")])),
      at(3, result("s1")),
      at(4, assistant([{ type: "text", text: "Done." }])),
    ];
    const items = (list: typeof run1) => chatItems(list, { tools: {}, running: false });
    expect(latestSummary(items(run1))).toBe("Changed the title");
    // A later run without a summary shows none; a failed call does not count.
    expect(latestSummary(items([...run1, at(5, user("second"))]))).toBeNull();
    expect(
      latestSummary(
        items([...run1, at(5, user("again")), at(6, assistant([summarize("s2", "x")])), at(7, result("s2", true))]),
      ),
    ).toBeNull();
  });

  it("follows the end of the list cheaply", () => {
    const one = chatItems([{ entryId: "e1", message: assistant([{ type: "text", text: "ab" }]) }], {
      tools: {},
      running: false,
    });
    const longer = chatItems([{ entryId: "e1", message: assistant([{ type: "text", text: "abc" }]) }], {
      tools: {},
      running: false,
    });
    expect(tailSignature(one)).not.toBe(tailSignature(longer));
    expect(tailSignature([])).toBe("0");
  });

  it("shows tool targets and result text", () => {
    expect(toolTarget({ path: "site.yaml" })).toBe("site.yaml");
    expect(toolTarget({ pattern: "*.md" })).toBe("*.md");
    expect(toolTarget({})).toBe("");
    expect(resultText({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] })).toBe(
      "a\nb",
    );
    expect(resultText({ other: 1 })).toContain('"other": 1');
    expect(resultText(null)).toBe("");
  });
});

describe("events and the query cache", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient();
    liveStore.reset();
  });

  it("keeps session lists and details current", () => {
    const other = info({ id: "bbbbbbbbbbbbbbbb" });
    qc.setQueryData(keys.sessions(S.siteId), [other]);
    handleEvent(qc, ev({ ...S, type: "session.updated", data: { session: info({ title: "New" }) } }));
    expect(qc.getQueryData<SessionInfo[]>(keys.sessions(S.siteId))?.map((s) => s.title)).toEqual(["New", null]);

    qc.setQueryData<SessionDetail>(keys.session(S.sessionId), { session: info(), messages: [] });
    handleEvent(qc, status("running"));
    expect(qc.getQueryData<SessionInfo[]>(keys.sessions(S.siteId))?.[0]?.status).toBe("running");
    expect(qc.getQueryData<SessionDetail>(keys.session(S.sessionId))?.session.status).toBe("running");

    handleEvent(qc, status("idle"));
    // The finished run is fetched again, for its entry ids.
    expect(qc.getQueryState(keys.session(S.sessionId))?.isInvalidated).toBe(true);

    handleEvent(qc, ev({ ...S, type: "session.deleted", data: {} }));
    expect(qc.getQueryData<SessionInfo[]>(keys.sessions(S.siteId))?.map((s) => s.id)).toEqual([other.id]);
    expect(qc.getQueryData(keys.session(S.sessionId))).toBeUndefined();
    // An open view sees the mark and leaves without fetching the session again.
    expect(liveStore.isDeleted(S.sessionId)).toBe(true);
  });

  it("keeps only the error of a finished run that nobody shows", () => {
    handleEvent(qc, status("running"));
    handleEvent(qc, delta(0, "partial"));
    handleEvent(qc, end(assistant([{ type: "text", text: "partial" }])));
    handleEvent(qc, status("idle"));
    expect(liveStore.get(S.sessionId)).toEqual(emptyLive());

    handleEvent(qc, status("running"));
    handleEvent(qc, end(assistant([], { timestamp: 9 })));
    handleEvent(qc, status("idle", "agent.no_model"));
    expect(liveStore.get(S.sessionId)).toEqual({ ...emptyLive(), error: "agent.no_model" });
  });

  it("refreshes builds on build events, and everything on resync", () => {
    qc.setQueryData(keys.builds(S.siteId), { builds: [] });
    qc.setQueryData(keys.sites, []);
    handleEvent(qc, ev({ type: "build.start", siteId: S.siteId, data: { build: {} as never } }));
    expect(qc.getQueryState(keys.builds(S.siteId))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.sites)?.isInvalidated).toBe(false);

    handleEvent(qc, delta(0, "partial"));
    expect(liveStore.get(S.sessionId).text).toBe("partial");
    handleEvent(qc, ev({ type: "resync", data: {} }));
    expect(qc.getQueryState(keys.sites)?.isInvalidated).toBe(true);
    expect(liveStore.get(S.sessionId).text).toBeNull();
  });
  it("keeps the change set current and marks the panels it makes stale", () => {
    const change = (snapshotCommit: string) => ({ id: "c1", siteId: S.siteId, snapshotCommit }) as never;
    const main = keys.panel(S.siteId, "tree", "main", "");
    const inChange = keys.panel(S.siteId, "tree", "change", "");
    const fresh = () => {
      qc.setQueryData(main, {});
      qc.setQueryData(inChange, {});
    };
    fresh();
    handleEvent(qc, ev({ type: "change", siteId: S.siteId, data: { change: change("a") } }));
    expect(qc.getQueryData(keys.change(S.siteId))).toEqual({ change: change("a") });
    expect(qc.getQueryState(inChange)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(main)?.isInvalidated).toBe(false);

    // The same snapshot (e.g. only reviewable changed): nothing to refetch.
    fresh();
    handleEvent(qc, ev({ type: "change", siteId: S.siteId, data: { change: change("a") } }));
    expect(qc.getQueryState(inChange)?.isInvalidated).toBe(false);

    // Closed (applied or rejected): the main version may have moved.
    fresh();
    handleEvent(qc, ev({ type: "change", siteId: S.siteId, data: { change: null } }));
    expect(qc.getQueryData(keys.change(S.siteId))).toEqual({ change: null });
    expect(qc.getQueryState(main)?.isInvalidated).toBe(true);
    // The closed snapshot is dropped, not fetched again (it would only answer change.not_found).
    expect(qc.getQueryState(inChange)).toBeUndefined();
  });
});
