import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerEvent, SessionDetail, SessionInfo } from "@bukitjalil/shared";
import type { Api, Model } from "@earendil-works/pi-ai";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { preparePiEnvironment } from "../src/agent/env.ts";
import { loadPi, type PiModules } from "../src/agent/pi.ts";
import { copyStarter } from "../src/sites/template.ts";
import { ADMIN, commitAllAs, makeApp, rawGit, req } from "./helpers.ts";

const STARTER = path.resolve(import.meta.dirname, "../../../templates/starter");

// Pi keeps the directory it saw when it loaded, so this file uses one app home.
let base: string;
let ctx: ReturnType<typeof makeApp>;
let pi: PiModules;
let faux: ReturnType<PiModules["ai"]["fauxProvider"]>;
let useModel = true;
const streams: { close: () => Promise<void> }[] = [];

beforeAll(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-sessions-")));
  fs.mkdirSync(path.join(base, "home"));
  ctx = makeApp({
    userHome: path.join(base, "home"),
    appHome: path.join(base, "app"),
    replayBytes: 64 * 1024,
    eventStream: { pingMs: 40, maxQueuedBytes: 32 * 1024 },
    agent: {
      resolveModel: () => (useModel ? (faux.getModel() as Model<Api>) : undefined),
      setupRuntime: (runtime) => runtime.registerNativeProvider(faux.provider),
    },
  });
  preparePiEnvironment(ctx.paths.pi);
  pi = await loadPi(ctx.paths.pi);
  faux = pi.ai.fauxProvider({ provider: "faux", models: [{ id: "faux-1", name: "Faux" }] });
});
afterEach(async () => {
  useModel = true;
  await Promise.all(streams.splice(0).map((s) => s.close()));
});
afterAll(async () => {
  await ctx.agent.shutdown();
  fs.rmSync(base, { recursive: true, force: true });
});

let siteCount = 0;
async function site() {
  const dir = path.join(base, "home", `site${++siteCount}`);
  copyStarter(STARTER, dir, { title: `Site ${siteCount}`, language: "en-US" });
  rawGit(base, dir, "init", "-q", "-b", "main");
  commitAllAs(base, dir);
  return ctx.sites.import({ path: dir });
}

const call = (method: string, url: string, body?: unknown) =>
  ctx.app.fetch(
    req(url, {
      method,
      ...(body === undefined
        ? { headers: { origin: ADMIN, "x-bukitjalil": "1", "content-type": "application/json" } }
        : {
            body: JSON.stringify(body),
            headers: { origin: ADMIN, "x-bukitjalil": "1", "content-type": "application/json" },
          }),
    }),
  );
const get = (url: string) => ctx.app.fetch(req(url));

async function waitFor(condition: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Open GET /api/events and collect its events. */
async function openEvents(lastEventId?: string, opts: { read?: boolean } = {}) {
  const res = await ctx.app.fetch(req("/api/events", { headers: lastEventId ? { "last-event-id": lastEventId } : {} }));
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const events: ServerEvent[] = [];
  const blocks: string[] = [];
  let buffer = "";
  let done = false;
  const pump = (async () => {
    if (opts.read === false) return;
    for (;;) {
      const chunk = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      for (let i = buffer.indexOf("\n\n"); i >= 0; i = buffer.indexOf("\n\n")) {
        const block = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        blocks.push(block);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data: ") || l.startsWith("data:"))
          .map((l) => l.replace(/^data: ?/, ""))
          .join("\n");
        if (data) events.push(JSON.parse(data));
      }
    }
    done = true;
  })();
  const stream = {
    res,
    events,
    blocks,
    ended: () => done,
    /** Read until the stream ends (for a stream opened without reading). */
    drain: async () => {
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {}
    },
    of: (sessionId: string) => events.filter((e) => "sessionId" in e && e.sessionId === sessionId),
    close: async () => {
      await reader.cancel().catch(() => {});
      await pump;
    },
  };
  streams.push(stream);
  return stream;
}

const idleAfterRun = (stream: Awaited<ReturnType<typeof openEvents>>, sessionId: string) =>
  waitFor(() =>
    stream
      .of(sessionId)
      .some((e, i, all) => e.type === "session.status" && e.data.status === "idle" && i > 0 && all.length > 1),
  );

describe("session API", () => {
  it("creates, lists, renames and deletes sessions", async () => {
    const s = await site();
    const created = await call("POST", `/api/sites/${s.id}/sessions`, {});
    expect(created.status).toBe(201);
    const session = (await created.json()) as SessionInfo;
    expect(session).toMatchObject({ siteId: s.id, title: null, status: "idle" });
    expect(session).not.toHaveProperty("file");

    const listed = (await (await get(`/api/sites/${s.id}/sessions`)).json()) as SessionInfo[];
    expect(listed.map((x) => x.id)).toEqual([session.id]);

    const renamed = await call("PATCH", `/api/sessions/${session.id}`, { title: "  Home page  " });
    expect(await renamed.json()).toMatchObject({ id: session.id, title: "Home page" });
    for (const bad of [{ title: "" }, { title: "a\u0000b" }, { title: "x".repeat(201) }, { name: "x" }, {}]) {
      expect((await call("PATCH", `/api/sessions/${session.id}`, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await (await call("PATCH", `/api/sessions/${session.id}`, { title: null })).json()).toMatchObject({
      title: null,
    });

    const detail = (await (await get(`/api/sessions/${session.id}`)).json()) as SessionDetail;
    expect(detail).toEqual({ session: { ...session, updatedAt: expect.any(String) }, messages: [] });

    expect((await call("DELETE", `/api/sessions/${session.id}`)).status).toBe(204);
    expect(await (await get(`/api/sessions/${session.id}`)).json()).toEqual({ code: "session.not_found" });
    expect(await (await get(`/api/sites/${s.id}/sessions`)).json()).toEqual([]);
  });

  it("answers 404 for unknown sites and sessions, and 400 for bad bodies", async () => {
    expect(await (await get("/api/sites/nope/sessions")).json()).toEqual({ code: "site.not_found" });
    expect((await call("POST", "/api/sites/nope/sessions", {})).status).toBe(404);
    for (const id of ["0123456789abcdef", "../etc", "x"]) {
      expect((await get(`/api/sessions/${id}`)).status).toBe(404);
      expect((await call("POST", `/api/sessions/${id}/abort`, {})).status).toBe(404);
    }
    const s = await site();
    const session = ctx.agent.create(s.id);
    for (const bad of [{}, { text: "   " }, { text: "hi", mode: "shout" }, { text: "x".repeat(100_001) }]) {
      expect((await call("POST", `/api/sessions/${session.id}/messages`, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    for (const bad of [{}, { entryId: "../x" }, { entryId: "ZZ" }]) {
      expect((await call("POST", `/api/sessions/${session.id}/fork`, bad)).status).toBe(400);
    }
    // Forking a session that has no messages yet.
    expect(await (await call("POST", `/api/sessions/${session.id}/fork`, { entryId: "abc123" })).json()).toEqual({
      code: "session.entry_not_found",
    });
  });

  it("refuses messages without a model, and sessions on read-only sites", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    useModel = false;
    const res = await call("POST", `/api/sessions/${session.id}/messages`, { text: "Hi" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "agent.no_model" });
    useModel = true;
    ctx.db.prepare("UPDATE sites SET read_only_reasons = ? WHERE id = ?").run('[{"code":"site.repo_unsafe"}]', s.id);
    expect(await (await call("POST", `/api/sites/${s.id}/sessions`, {})).json()).toEqual({ code: "site.read_only" });
    expect((await call("POST", `/api/sessions/${session.id}/messages`, { text: "Hi" })).status).toBe(409);
  });

  it("runs a message and streams the reply; the session then shows its messages", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const stream = await openEvents();
    expect(stream.res.status).toBe(200);
    expect(stream.res.headers.get("content-type")).toContain("text/event-stream");
    faux.setResponses([pi.ai.fauxAssistantMessage("Hello from the stream, with a few words to split.")]);
    const res = await call("POST", `/api/sessions/${session.id}/messages`, { text: "Hi" });
    expect(res.status).toBe(202);
    expect(((await res.json()) as SessionInfo).id).toBe(session.id);
    await idleAfterRun(stream, session.id);

    const mine = stream.of(session.id);
    const types = mine.map((e) => e.type);
    expect(types[0]).toBe("session.status");
    expect(types).toContain("message.delta");
    expect(types).toContain("run.settled");
    expect(types.at(-1)).toBe("session.status");
    // The deltas add up to the reply.
    let text = "";
    for (const e of mine) if (e.type === "message.delta") text = text.slice(0, e.data.offset) + e.data.text;
    expect(text).toBe("Hello from the stream, with a few words to split.");
    const ends = mine.flatMap((e) => (e.type === "message.end" ? [e.data.message.role] : []));
    expect(ends).toEqual(["user", "assistant"]);
    // Every event has an SSE id, and the stream told the browser how soon to reconnect.
    expect(stream.blocks[0]).toBe("retry: 2000");
    for (const block of stream.blocks.slice(1).filter((b) => b !== ": ping")) {
      expect(block).toMatch(/(^|\n)id: [0-9a-f]{8}-\d+(\n|$)/);
    }

    const detail = (await (await get(`/api/sessions/${session.id}`)).json()) as SessionDetail;
    expect(detail.session.status).toBe("idle");
    expect(detail.messages.map((m) => m.message.role)).toEqual(["user", "assistant"]);
    expect(detail.messages.every((m) => /^[0-9a-f]+$/.test(m.entryId))).toBe(true);
    // After the AgentSession is gone, the same messages come back from the file.
    await ctx.agent.closeSite(s.id);
    expect(((await (await get(`/api/sessions/${session.id}`)).json()) as SessionDetail).messages).toEqual(
      detail.messages,
    );
  });

  it("replays missed events on reconnect, and asks for a resync when they are gone", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const first = await openEvents();
    faux.setResponses([pi.ai.fauxAssistantMessage("one")]);
    await call("POST", `/api/sessions/${session.id}/messages`, { text: "Hi" });
    await idleAfterRun(first, session.id);
    const mine = first.of(session.id);
    const lastSeen = mine[0]?.id as string;
    await first.close();

    const again = await openEvents(lastSeen);
    await waitFor(() => again.events.length >= 1);
    await waitFor(() => again.of(session.id).some((e) => e.type === "session.status" && e.data.status === "idle"));
    const replayed = again.of(session.id);
    // Deltas were dropped when the message ended; everything else after lastSeen comes back in order.
    expect(replayed.map((e) => e.id)).toEqual(
      mine
        .slice(1)
        .filter((e) => e.type !== "message.delta")
        .map((e) => e.id),
    );

    const stale = await openEvents("00000000-1");
    await waitFor(() => stale.events.length >= 1);
    expect(stale.events[0]?.type).toBe("resync");
  });

  it("stops a run on abort", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const stream = await openEvents();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let started = false;
    faux.setResponses([
      async () => {
        started = true;
        await gate;
        return pi.ai.fauxAssistantMessage("late");
      },
    ]);
    await call("POST", `/api/sessions/${session.id}/messages`, { text: "Hi" });
    await waitFor(() => started);
    // Pi's abort waits for the model call to return, so the reply is released while it stops.
    const aborting = call("POST", `/api/sessions/${session.id}/abort`, {});
    await waitFor(() => ctx.agent.status(session.id) === "running");
    release();
    expect((await aborting).status).toBe(200);
    await idleAfterRun(stream, session.id);
    expect(stream.of(session.id).some((e) => e.type === "run.settled" && e.data.aborted)).toBe(true);
    expect(((await (await get(`/api/sessions/${session.id}`)).json()) as SessionDetail).session.status).toBe("idle");
  });

  it("forks a session from one of its messages", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    ctx.agent.rename(session.id, "Original");
    const stream = await openEvents();
    faux.setResponses([pi.ai.fauxAssistantMessage("first reply"), pi.ai.fauxAssistantMessage("second reply")]);
    await call("POST", `/api/sessions/${session.id}/messages`, { text: "first" });
    await idleAfterRun(stream, session.id);
    await call("POST", `/api/sessions/${session.id}/messages`, { text: "second" });
    await waitFor(() => stream.of(session.id).filter((e) => e.type === "run.settled").length === 2);
    await waitFor(() => ctx.agent.status(session.id) === "idle");
    const { messages } = (await (await get(`/api/sessions/${session.id}`)).json()) as SessionDetail;
    expect(messages).toHaveLength(4);

    const res = await call("POST", `/api/sessions/${session.id}/fork`, { entryId: messages[1]?.entryId });
    expect(res.status).toBe(201);
    const fork = (await res.json()) as SessionInfo;
    expect(fork).toMatchObject({ siteId: s.id, title: "Original", status: "idle" });
    expect(fork.id).not.toBe(session.id);
    const forked = (await (await get(`/api/sessions/${fork.id}`)).json()) as SessionDetail;
    expect(forked.messages).toEqual(messages.slice(0, 2));
    // The fork's file is the session's own, not one of Pi's naming.
    expect(fs.readdirSync(path.join(ctx.paths.sessions, s.id)).sort()).toEqual(
      [`${session.id}.jsonl`, `${fork.id}.jsonl`].sort(),
    );
    // The fork carries on by itself; the original is unchanged.
    faux.setResponses([pi.ai.fauxAssistantMessage("fork reply")]);
    await call("POST", `/api/sessions/${fork.id}/messages`, { text: "third" });
    await idleAfterRun(stream, fork.id);
    const after = (await (await get(`/api/sessions/${fork.id}`)).json()) as SessionDetail;
    expect(after.messages.map((m) => m.message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(((await (await get(`/api/sessions/${session.id}`)).json()) as SessionDetail).messages).toEqual(messages);
    expect(await (await call("POST", `/api/sessions/${session.id}/fork`, { entryId: "ffffffff" })).json()).toEqual({
      code: "session.entry_not_found",
    });
  });

  it("tells every tab when sessions are created, renamed, forked or deleted", async () => {
    const s = await site();
    const stream = await openEvents();
    const created = (await (await call("POST", `/api/sites/${s.id}/sessions`, {})).json()) as SessionInfo;
    await call("PATCH", `/api/sessions/${created.id}`, { title: "Renamed" });
    await call("DELETE", `/api/sessions/${created.id}`);
    await waitFor(() => stream.of(created.id).some((e) => e.type === "session.deleted"));
    expect(
      stream.of(created.id).map((e) => [e.type, e.type === "session.updated" ? e.data.session.title : null]),
    ).toEqual([
      ["session.updated", null],
      ["session.updated", "Renamed"],
      ["session.deleted", null],
    ]);
    expect(stream.of(created.id)[0]?.data).toEqual({ session: created });
  });

  it("says when a session file is damaged", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const file = path.join(ctx.paths.sessions, s.id, `${session.id}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not a session\n");
    const res = await get(`/api/sessions/${session.id}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "session.unreadable" });
    expect(await (await call("POST", `/api/sessions/${session.id}/fork`, { entryId: "abc" })).json()).toEqual({
      code: "session.unreadable",
    });
    // A run ends with the same code, and the file is left as it was.
    const stream = await openEvents();
    await call("POST", `/api/sessions/${session.id}/messages`, { text: "Hi" });
    await idleAfterRun(stream, session.id);
    expect(stream.of(session.id).at(-1)?.data).toEqual({ status: "idle", error: "session.unreadable" });
    expect(fs.readFileSync(file, "utf8")).toBe("not a session\n");
  });

  it("steers a running session, and queues follow-ups after it", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const stream = await openEvents();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let started = false;
    const seen: string[] = [];
    const lastUser = (context: unknown) => {
      const messages = (context as { messages: { role: string; content: unknown }[] }).messages;
      return JSON.stringify(messages.filter((m) => m.role === "user").at(-1)?.content);
    };
    faux.setResponses([
      async (context) => {
        seen.push(lastUser(context));
        started = true;
        await gate;
        return pi.ai.fauxAssistantMessage("one");
      },
      (context) => {
        seen.push(lastUser(context));
        return pi.ai.fauxAssistantMessage("two");
      },
      (context) => {
        seen.push(lastUser(context));
        return pi.ai.fauxAssistantMessage("three");
      },
    ]);
    await call("POST", `/api/sessions/${session.id}/messages`, { text: "first" });
    await waitFor(() => started);
    expect(
      (await call("POST", `/api/sessions/${session.id}/messages`, { text: "later", mode: "followUp" })).status,
    ).toBe(202);
    expect((await call("POST", `/api/sessions/${session.id}/messages`, { text: "now", mode: "steer" })).status).toBe(
      202,
    );
    release();
    await idleAfterRun(stream, session.id);
    // The steering message is answered before the follow-up, all in the same run.
    expect(seen).toEqual([
      expect.stringContaining('"first"'),
      expect.stringContaining('"now"'),
      expect.stringContaining('"later"'),
    ]);
    expect(
      stream
        .of(session.id)
        .filter((e) => e.type === "session.status")
        .map((e) => e.data.status),
    ).toEqual(["running", "idle"]);
  });

  it("pings an idle stream, and drops a client that stops reading", async () => {
    const stream = await openEvents();
    await waitFor(() => stream.blocks.includes(": ping"));

    const before = ctx.events.subscriberCount;
    const stalled = await openEvents(undefined, { read: false });
    await waitFor(() => ctx.events.subscriberCount === before + 1);
    for (let i = 0; i < 100 && ctx.events.subscriberCount > before; i++) {
      ctx.events.publish({
        siteId: "x",
        sessionId: "0000000000000000",
        type: "session.summary",
        data: { summary: "y".repeat(1000) },
      });
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(ctx.events.subscriberCount).toBe(before);
    // Its body ends, so the browser reconnects.
    await stalled.drain();
  });

  it("closes the stream when the client goes away, and on shutdown", async () => {
    const before = ctx.events.subscriberCount;
    const stream = await openEvents();
    await waitFor(() => ctx.events.subscriberCount === before + 1);
    await stream.close();
    await waitFor(() => ctx.events.subscriberCount === before);

    const other = await openEvents();
    await waitFor(() => ctx.events.subscriberCount === before + 1);
    ctx.events.closeAll();
    await waitFor(() => other.ended());
  });

  it("needs the session cookie", async () => {
    const res = await ctx.app.fetch(req("/api/events", { cookie: false }));
    expect(res.status).toBe(401);
  });
});
