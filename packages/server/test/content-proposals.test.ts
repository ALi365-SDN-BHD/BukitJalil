import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ContentBody, ContentDatabase, ContentPage, ContentProposal } from "@bukitjalil/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ContentProposals, createProposeTools, proposalIds, proposalIn } from "../src/agent/content-proposals.ts";
import type { NotionContentService } from "../src/data-sources/notion-content.ts";
import { SiteError } from "../src/sites/location.ts";
import { makeApp } from "./helpers.ts";

// Content editor and AI design, A2: the content assistant proposes, and only the user's confirmation writes.
// The Notion content service is a stub here (its own tests cover Notion).
const DB = "0123456789abcdef0123456789abcdef";
const OPEN = "11111111111111111111111111111111";
const IMAGE = "33333333333333333333333333333333";
const BASE = "2026-11-22T08:00:00.000Z";

interface Stub {
  calls: string[];
  body?: Partial<ContentBody>;
  fail?: Partial<Record<"update" | "saveBody" | "create", Error>>;
}

function stub(s: Stub) {
  const page = (id: string): ContentPage => ({
    id,
    databaseId: DB,
    title: "Hello",
    url: null,
    lastEditedTime: BASE,
    properties: [
      { name: "Name", type: "title", value: { type: "title", text: "Hello" }, display: "Hello" },
      // Its display text is cut; the proposal shows the whole value.
      { name: "Summary", type: "rich_text", value: { type: "rich_text", text: "Long text" }, display: "Long…" },
      { name: "Stage", type: "status", value: { type: "status", option: "Draft" }, display: "Draft" },
      { name: "Tags", type: "multi_select", value: { type: "multi_select", options: [] }, display: "" },
      { name: "Due", type: "date", value: { type: "date", start: null, end: null }, display: "" },
      { name: "Related", type: "relation", value: null, display: "2" },
    ],
  });
  const fail = (name: keyof NonNullable<Stub["fail"]>) => {
    const err = s.fail?.[name];
    if (err) throw err;
  };
  return {
    database: async (): Promise<ContentDatabase> => ({
      id: DB,
      title: "Blog",
      url: null,
      properties: [
        { name: "Name", type: "title", editable: true },
        {
          name: "Stage",
          type: "status",
          editable: true,
          options: [
            { name: "Draft", color: "red" },
            { name: "Done", color: "green" },
          ],
        },
        { name: "Tags", type: "multi_select", editable: true, options: [] },
        { name: "Due", type: "date", editable: true },
        { name: "Related", type: "relation", editable: false },
      ],
      propertiesTruncated: false,
    }),
    page: async (_s: string, _d: string, id: string) => page(id),
    body: async (): Promise<ContentBody> => ({
      blocks: [
        { type: "paragraph", text: [{ text: "Old" }] },
        { type: "notion_image", id: IMAGE, url: "https://files.example/signed", caption: [] },
      ],
      editable: true,
      unsupported: [],
      lastEditedTime: BASE,
      ...s.body,
    }),
    saveBody: async (_s: string, _d: string, id: string, req: { lastEditedTime: string; blocks: unknown[] }) => {
      s.calls.push(`saveBody ${id} ${req.lastEditedTime} ${req.blocks.length}`);
      fail("saveBody");
      return { blocks: [], editable: true, unsupported: [], lastEditedTime: "2026-11-22T08:05:00.000Z" };
    },
    update: async (_s: string, _d: string, id: string, req: { lastEditedTime: string; properties: object }) => {
      s.calls.push(`update ${id} ${req.lastEditedTime} ${Object.keys(req.properties).join(",")}`);
      fail("update");
      return page(id);
    },
    create: async (_s: string, _d: string, req: { properties: object; blocks?: unknown[] }) => {
      s.calls.push(`create ${Object.keys(req.properties).join(",")} ${req.blocks?.length ?? 0}`);
      fail("create");
      return page("44444444444444444444444444444444");
    },
  } as unknown as NotionContentService;
}

const ref = (sourceId: string) => ({ sourceId, databaseId: DB });

function tools(s: Stub, current: string | null = OPEN, sourceId = "ds_0123456789ab") {
  return Object.fromEntries(
    createProposeTools({ content: stub(s), ref: ref(sourceId), current: () => current }).map((t) => [
      t.name,
      async (params: Record<string, unknown>) => {
        const withBase =
          t.name === "propose_update" ? { entryId: current ?? OPEN, lastEditedTime: BASE, ...params } : params;
        const r = (await t.execute("call_1", withBase as never, undefined, undefined as never, undefined as never)) as {
          details: { proposal: ContentProposal };
        };
        return r.details.proposal;
      },
    ]),
  );
}

describe("propose tools", () => {
  it("record a change to the open entry with its before and after, and write nothing", async () => {
    const calls: string[] = [];
    const t = tools({ calls });
    const proposal = await t.propose_update?.({
      properties: { Name: "Hello", Stage: "Done", Tags: ["a", "b"], Due: "2026-12-01", Summary: "Long text, more" },
      body: `New **text**\n\n![](notion-image:${IMAGE})`,
    });
    expect(calls).toEqual([]);
    expect(proposal).toMatchObject({
      kind: "update",
      entryId: OPEN,
      title: "Hello",
      base: BASE,
      // An unchanged value is left out.
      properties: [
        { name: "Stage", before: "Draft", after: { type: "status", option: "Done" } },
        { name: "Tags", before: "", after: { type: "multi_select", options: ["a", "b"] } },
        { name: "Due", after: { type: "date", start: "2026-12-01", end: null } },
        { name: "Summary", before: "Long text", after: { type: "rich_text", text: "Long text, more" } },
      ],
      body: { before: `Old\n\n![](notion-image:${IMAGE})`, after: `New **text**\n\n![](notion-image:${IMAGE})` },
    });
    expect(proposal?.blocks?.[0]).toEqual({
      type: "paragraph",
      text: [{ text: "New " }, { text: "text", bold: true }],
    });
  });

  it("refuse, to the model, what cannot be written", async () => {
    const t = tools({ calls: [] });
    const refused = (params: Record<string, unknown>, message: RegExp, tool = t.propose_update) =>
      expect(tool?.(params)).rejects.toThrow(message);
    await refused({ properties: { Nope: "x" } }, /no property "Nope"/);
    await refused({ properties: { Related: "x" } }, /cannot be edited/);
    await refused({ properties: { Stage: "Later" } }, /one of its options \("Draft", "Done"\)/);
    await refused({ properties: { Tags: "a" } }, /array of option names/);
    await refused({ properties: { Due: "tomorrow" } }, /Due/);
    await refused({ properties: { Name: "Hello" } }, /Nothing would change/);
    await refused({ body: "![](notion-image:55555555555555555555555555555555)" }, /notion-image/);
    await refused({ body: `![](notion-image:${IMAGE})\n\n![](notion-image:${IMAGE})` }, /in their order/);
    await refused({ properties: { Related: 1 } }, /cannot be edited/, t.propose_create);
    // Another entry than the open one, even with the same edit time (Notion's are by the minute).
    await refused(
      { entryId: "55555555555555555555555555555555", properties: { Stage: "Done" } },
      /not the open entry|only for the open entry/,
    );
    await refused({ entryId: undefined, properties: { Stage: "Done" } }, /only for the open entry/);
    // The id as read_entry gives it, with Notion's dashes, is the open entry.
    expect(
      await t.propose_update?.({
        entryId: `${OPEN.slice(0, 8)}-${OPEN.slice(8, 12)}-${OPEN.slice(12, 16)}-${OPEN.slice(16, 20)}-${OPEN.slice(20)}`,
        properties: { Stage: "Done" },
      }),
    ).toMatchObject({ entryId: OPEN });
    // Made from an older version than the entry has now: read it again first.
    await refused({ lastEditedTime: "2026-11-22T07:00:00.000Z", properties: { Stage: "Done" } }, /read it again/);
    await expect(tools({ calls: [] }, null).propose_update?.({ properties: { Stage: "Done" } })).rejects.toThrow(
      /no entry open/,
    );
    await expect(
      tools({ calls: [], body: { editable: false, unsupported: ["table"], blocks: [] } }).propose_update?.({
        body: "x",
      }),
    ).rejects.toThrow(/cannot be edited here \(table\)/);
  });

  it("record a new entry", async () => {
    const proposal = await tools({ calls: [] }, null).propose_create?.({
      properties: { Name: "Fresh", Stage: null },
      body: "# Hi",
    });
    expect(proposal).toMatchObject({
      kind: "create",
      entryId: null,
      title: "Fresh",
      base: null,
      properties: [
        { name: "Name", before: null, after: { type: "title", text: "Fresh" } },
        { name: "Stage", after: { type: "status", option: null } },
      ],
      body: { before: null, after: "# Hi" },
      blocks: [{ type: "heading_1", text: [{ text: "Hi" }] }],
    });
    // A new entry cannot keep images of another one.
    await expect(
      tools({ calls: [] }).propose_create?.({ properties: {}, body: `![](notion-image:${IMAGE})` }),
    ).rejects.toThrow(/notion-image/);
  });

  it("are found in the conversation by tool call id", () => {
    const proposal = { kind: "create" } as ContentProposal;
    const messages = [
      { message: { role: "toolResult", toolCallId: "a", toolName: "propose_create", details: { proposal } } },
      { message: { role: "toolResult", toolCallId: "b", toolName: "propose_update", isError: true, details: {} } },
      { message: { role: "toolResult", toolCallId: "c", toolName: "read_entry", details: { proposal } } },
    ];
    expect(proposalIn(messages, "a")).toBe(proposal);
    expect(proposalIn(messages, "b")).toBeNull();
    expect(proposalIn(messages, "c")).toBeNull();
    expect(proposalIds(messages)).toEqual(["a"]);
  });
});

describe("proposal decisions", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bukitjalil-proposals-"));
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));
  let ctx: ReturnType<typeof makeApp>;
  let sourceId: string;
  let n = 0;
  beforeEach(() => {
    ctx = makeApp({ appHome: path.join(base, `app-${++n}`) });
    sourceId = ctx.dataSources.create({ platform: "notion", name: "Notes", token: "ntn_proposaltesttoken1" }).id;
  });

  const update = (over: Partial<ContentProposal> = {}): ContentProposal => ({
    kind: "update",
    entryId: OPEN,
    title: "Hello",
    base: BASE,
    properties: [{ name: "Stage", type: "status", before: "Draft", after: { type: "status", option: "Done" } }],
    body: { before: "Old", after: "New" },
    blocks: [{ type: "paragraph", text: [{ text: "New" }] }],
    ...over,
  });

  it("write the body, then the properties at the new edit time, once; and tell the model once", async () => {
    const calls: string[] = [];
    const p = new ContentProposals(ctx.db, stub({ calls }));
    expect(p.states(ref(sourceId), ["c1"])).toEqual([{ callId: "c1", status: "pending", entryId: null, error: null }]);
    expect(await p.apply(ref(sourceId), "s1", "c1", update())).toEqual({
      callId: "c1",
      status: "applied",
      entryId: OPEN,
      error: null,
    });
    expect(calls).toEqual([`saveBody ${OPEN} ${BASE} 1`, `update ${OPEN} 2026-11-22T08:05:00.000Z Stage`]);
    await expect(p.apply(ref(sourceId), "s2", "c1", update())).rejects.toMatchObject({
      code: "content.proposal_decided",
    });
    expect(() => p.reject(ref(sourceId), "s1", "c1")).toThrow(
      expect.objectContaining({ code: "content.proposal_decided" }),
    );

    expect(p.notes("s2")).toBeNull();
    const notes = p.notes("s1");
    expect(notes?.text).toContain(`c1: written to Notion (entry ${OPEN})`);
    notes?.ack();
    expect(p.notes("s1")).toBeNull();
  });

  it("record a failure, which may be tried again, and a partial write, which says so", async () => {
    const calls: string[] = [];
    const conflict = new SiteError("content.conflict", 409);
    const failing = new ContentProposals(ctx.db, stub({ calls, fail: { saveBody: conflict } }));
    expect(await failing.apply(ref(sourceId), "s1", "c1", update())).toMatchObject({
      status: "failed",
      error: "content.conflict",
    });
    // Tried again while the note of the failure was being sent: the success is still told next time.
    const told = failing.notes("s1");
    expect(told?.text).toContain("c1: writing failed (content.conflict)");
    await new Promise((r) => setTimeout(r, 2));
    expect(
      await new ContentProposals(ctx.db, stub({ calls })).apply(ref(sourceId), "s1", "c1", update()),
    ).toMatchObject({
      status: "applied",
    });
    told?.ack();
    expect(failing.notes("s1")?.text).toContain("c1: written to Notion");
    failing.notes("s1")?.ack();
    // Decided again at the same moment with the same status but another error: told next time too.
    const atOnce = new ContentProposals(ctx.db, stub({ calls, fail: { saveBody: conflict } }));
    expect(await atOnce.apply(ref(sourceId), "s1", "c9", update())).toMatchObject({ error: "content.conflict" });
    const first = atOnce.notes("s1");
    ctx.db.prepare("UPDATE content_proposals SET error = 'datasource.notion_failed' WHERE call_id = 'c9'").run();
    first?.ack();
    expect(atOnce.notes("s1")?.text).toContain("c9: writing failed (datasource.notion_failed)");
    ctx.db.prepare("DELETE FROM content_proposals").run();
    const partial = new ContentProposals(ctx.db, stub({ calls, fail: { update: conflict } }));
    expect(await partial.apply(ref(sourceId), "s1", "c1", update())).toMatchObject({
      status: "failed",
      error: "content.proposal_partial",
    });
    // Written in part: trying again would only conflict with what was written.
    await expect(partial.apply(ref(sourceId), "s1", "c1", update())).rejects.toMatchObject({
      code: "content.proposal_decided",
    });
    // Part of a new page was left in Notion: creating it again would make a second page.
    const half = new ContentProposals(
      ctx.db,
      stub({ calls, fail: { create: new SiteError("content.body_partial", 503) } }),
    );
    const created = update({ kind: "create", entryId: null, base: null, body: null, blocks: null });
    expect(await half.apply(ref(sourceId), "s1", "c5", created)).toMatchObject({
      status: "failed",
      error: "content.body_partial",
    });
    await expect(half.apply(ref(sourceId), "s1", "c5", created)).rejects.toMatchObject({
      code: "content.proposal_decided",
    });
    // Notion did not answer the new page, or failed unexpectedly: it may be there, so it is not made again.
    for (const [i, err] of [new SiteError("content.create_unknown", 503), new TypeError("boom")].entries()) {
      const unclear = new ContentProposals(ctx.db, stub({ calls, fail: { create: err } }));
      const tried = unclear.apply(ref(sourceId), "s1", `u${i}`, created);
      if (err instanceof SiteError)
        expect(await tried).toMatchObject({ status: "failed", error: "content.proposal_unknown" });
      else await expect(tried).rejects.toBe(err);
      expect(unclear.states(ref(sourceId), [`u${i}`])[0]).toMatchObject({ error: "content.proposal_unknown" });
      await expect(unclear.apply(ref(sourceId), "s1", `u${i}`, created)).rejects.toMatchObject({
        code: "content.proposal_decided",
      });
    }
    // A half-written page Notion moved to the trash: creating again makes no duplicate.
    const trashed = new ContentProposals(
      ctx.db,
      stub({ calls, fail: { create: new SiteError("datasource.notion_failed", 503) } }),
    );
    expect(await trashed.apply(ref(sourceId), "s1", "u3", created)).toMatchObject({
      error: "datasource.notion_failed",
    });
    expect(half.notes("s1")?.text).toContain("u0: Notion did not answer");
    // Refused by Notion: nothing was made, so it may be tried again.
    const refusedCreate = new ContentProposals(
      ctx.db,
      stub({ calls, fail: { create: new SiteError("datasource.notion_rate_limited", 503) } }),
    );
    expect(await refusedCreate.apply(ref(sourceId), "s1", "u2", created)).toMatchObject({
      error: "datasource.notion_rate_limited",
    });
    // A new entry, written whole.
    const ok = new ContentProposals(ctx.db, stub({ calls }));
    expect(
      await ok.apply(
        ref(sourceId),
        "s1",
        "c2",
        update({ kind: "create", entryId: null, base: null, body: null, blocks: null }),
      ),
    ).toMatchObject({ status: "applied", entryId: "44444444444444444444444444444444" });
    expect(calls.at(-1)).toBe("create Stage 0");
    // A declined one is final, and an invalid one is not written.
    expect(ok.reject(ref(sourceId), "s1", "c3")).toMatchObject({ status: "rejected" });
    await expect(ok.apply(ref(sourceId), "s1", "c4", update({ base: null }))).rejects.toMatchObject({
      code: "content.proposal_invalid",
    });
    await expect(
      ok.apply(
        ref(sourceId),
        "s1",
        "c4",
        update({
          properties: [{ name: "Stage", type: "status", before: null, after: { type: "status", option: "a,b" } }],
        }),
      ),
    ).rejects.toMatchObject({ code: "content.proposal_invalid" });
    // Removing the data source removes its decisions.
    ctx.dataSources.remove(sourceId);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM content_proposals").get()).toEqual({ n: 0 });
  });

  it("write one proposal at a time", async () => {
    let release = () => {};
    const slow = stub({ calls: [] });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = slow.saveBody.bind(slow);
    slow.saveBody = (async (...args: Parameters<typeof original>) => {
      await wait;
      return original(...args);
    }) as typeof slow.saveBody;
    const p = new ContentProposals(ctx.db, slow);
    const first = p.apply(ref(sourceId), "s1", "c1", update());
    await expect(p.apply(ref(sourceId), "s1", "c1", update())).rejects.toMatchObject({ code: "content.proposal_busy" });
    expect(() => p.reject(ref(sourceId), "s1", "c1")).toThrow(
      expect.objectContaining({ code: "content.proposal_busy" }),
    );
    release();
    expect(await first).toMatchObject({ status: "applied" });
  });
});
