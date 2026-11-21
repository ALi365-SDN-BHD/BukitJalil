import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ContentBody, ContentDatabase, ContentEntryList, ContentPage, SavedDataSource } from "@bukitjalil/shared";
import { afterAll, describe, expect, it } from "vitest";
import { segments } from "../src/data-sources/notion-content.ts";
import { ADMIN, makeApp, req } from "./helpers.ts";

// Content management (plan 5.6): Notion pages read and written with a data source's token, against a fake
// Notion. Nothing here calls the real Notion API.

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-content-")));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const TOKEN = "ntn_contenttoken9876";
const DB = "1a2b3c4d5e6f40718293a4b5c6d7e8f9";
const OTHER_DB = "ffffffffffffffffffffffffffffffff";
const PAGE = "0123456789abcdef0123456789abcdef";
const DB_DASHED = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";

type Ctx = ReturnType<typeof makeApp>;
interface Sent {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  headers: Headers;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const rich = (text: string) => [{ type: "text", plain_text: text, text: { content: text } }];

function notionPage(overrides: Record<string, unknown> = {}) {
  return {
    object: "page",
    id: "01234567-89ab-cdef-0123-456789abcdef",
    url: "https://www.notion.so/Hello-0123456789abcdef0123456789abcdef",
    last_edited_time: "2026-11-21T08:00:00.000Z",
    archived: false,
    parent: { type: "database_id", database_id: DB_DASHED },
    properties: {
      Name: { id: "title", type: "title", title: rich("Hello") },
      Summary: { id: "a", type: "rich_text", rich_text: rich("First ") },
      Note: {
        id: "l",
        type: "rich_text",
        rich_text: [
          {
            type: "text",
            plain_text: "bold",
            text: { content: "bold" },
            annotations: { bold: true, color: "default" },
          },
        ],
      },
      Views: { id: "b", type: "number", number: 7 },
      Stage: { id: "c", type: "status", status: { name: "Draft" } },
      Tags: { id: "d", type: "multi_select", multi_select: [{ name: "a" }, { name: "b" }] },
      Published: { id: "e", type: "date", date: { start: "2026-11-20", end: null } },
      Featured: { id: "f", type: "checkbox", checkbox: true },
      Link: { id: "g", type: "url", url: null },
      Related: { id: "h", type: "relation", relation: [{ id: "x" }, { id: "y" }] },
      Author: { id: "i", type: "people", people: [{ name: "Ana" }] },
      Score: { id: "j", type: "formula", formula: { type: "number", number: 3 } },
      Edited: { id: "k", type: "last_edited_time", last_edited_time: "2026-11-21T08:00:00.000Z" },
    },
    ...overrides,
  };
}

/** A fake Notion API: records requests, answers from `page`, and lets a test force a status. */
function fakeNotion() {
  const sent: Sent[] = [];
  const state = {
    page: notionPage() as Record<string, unknown>,
    fail: null as null | { status: number; body?: unknown; when?: (s: Sent) => boolean },
    /** The page's top-level blocks, and the children of the blocks that have them. */
    blocks: [] as Record<string, unknown>[],
    children: {} as Record<string, Record<string, unknown>[]>,
  };
  const touch = () => {
    state.page = { ...state.page, last_edited_time: "2026-11-21T09:00:00.000Z" };
  };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const s: Sent = {
      method: init?.method ?? "GET",
      path: u.pathname.replace(/^\/v1/, ""),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      headers: new Headers(init?.headers),
    };
    expect(u.origin).toBe("https://api.notion.com");
    sent.push(s);
    if (state.fail && (!state.fail.when || state.fail.when(s))) return json(state.fail.body ?? {}, state.fail.status);
    if (s.method === "GET" && s.path === `/databases/${DB}`) {
      return json({
        object: "database",
        id: DB_DASHED,
        url: "https://www.notion.so/1a2b3c4d5e6f40718293a4b5c6d7e8f9",
        title: rich("Blog"),
        properties: {
          Tags: {
            id: "d",
            name: "Tags",
            type: "multi_select",
            multi_select: { options: [{ name: "a", color: "red" }] },
          },
          Name: { id: "title", name: "Name", type: "title", title: {} },
          Related: { id: "h", name: "Related", type: "relation", relation: {} },
          Stage: { id: "c", name: "Stage", type: "status", status: { options: [{ name: "Draft", color: "gray" }] } },
        },
      });
    }
    if (s.method === "POST" && s.path === `/databases/${DB}/query`) {
      return json({ object: "list", results: [state.page], has_more: true, next_cursor: "cursor-2" });
    }
    if (s.method === "GET" && s.path === `/pages/${PAGE}`) return json(state.page);
    if (s.method === "PATCH" && s.path === `/pages/${PAGE}`) {
      state.page = { ...state.page, last_edited_time: "2026-11-21T09:00:00.000Z" };
      return json(state.page);
    }
    if (s.method === "POST" && s.path === "/pages") return json(notionPage({ id: "fedcba9876543210fedcba9876543210" }));
    const children = /^\/blocks\/([0-9a-f]{32})\/children$/.exec(s.path);
    if (children && s.method === "GET") {
      const id = children[1] ?? "";
      return json({
        results: id === PAGE ? state.blocks : (state.children[id] ?? []),
        has_more: false,
        next_cursor: null,
      });
    }
    if (children && s.method === "PATCH") {
      touch();
      return json({ results: [] });
    }
    if (/^\/blocks\/[0-9a-f]{32}$/.test(s.path) && (s.method === "DELETE" || s.method === "PATCH")) {
      touch();
      return json({});
    }
    return json({ object: "error", status: 404 }, 404);
  }) as typeof fetch;
  return { sent, state, fetchImpl };
}

const call = (ctx: Ctx, method: string, p: string, body?: unknown) =>
  ctx.app.fetch(
    req(p, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
    }),
  );

async function setup(name: string, extra: Parameters<typeof makeApp>[0] = {}) {
  const notion = fakeNotion();
  const ctx = makeApp({ appHome: path.join(base, name), dataSourceFetch: notion.fetchImpl, ...extra });
  const source = (await (
    await call(ctx, "POST", "/api/data-sources", { platform: "notion", name: "Work", token: TOKEN })
  ).json()) as SavedDataSource;
  const db = `/api/content/sources/${source.id}/databases/${DB}`;
  return { ctx, notion, source, db, page: `${db}/pages/${PAGE}` };
}

describe("/api/content", () => {
  it("reads a database's properties, editable ones marked, with their choices", async () => {
    const { ctx, notion, db } = await setup("schema");
    const res = await call(ctx, "GET", db);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ContentDatabase;
    expect(body.title).toBe("Blog");
    expect(body.properties).toEqual([
      { name: "Name", type: "title", editable: true },
      { name: "Related", type: "relation", editable: false },
      { name: "Stage", type: "status", editable: true, options: [{ name: "Draft", color: "gray" }] },
      { name: "Tags", type: "multi_select", editable: true, options: [{ name: "a", color: "red" }] },
    ]);
    // The token goes to Notion with the pinned API version, and never back to the UI.
    expect(notion.sent[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(notion.sent[0]?.headers.get("notion-version")).toBe("2022-06-28");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    ctx.db.close();
  });

  it("lists entries newest first, searches by title and pages on", async () => {
    const { ctx, notion, db } = await setup("entries");
    const first = (await (await call(ctx, "GET", `${db}/pages`)).json()) as ContentEntryList;
    expect(notion.sent.at(-1)?.body).toEqual({
      page_size: 50,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    });
    expect(first.nextCursor).toBe("cursor-2");
    expect(first.entries[0]).toMatchObject({ title: "Hello", lastEditedTime: "2026-11-21T08:00:00.000Z" });
    expect(first.entries[0]?.cells).toMatchObject({
      Stage: "Draft",
      Tags: "a, b",
      Featured: "✓",
      Related: "2",
      Author: "Ana",
      Score: "3",
    });

    await call(ctx, "GET", `${db}/pages?cursor=cursor-2&search=%20Hel%20&sort=Stage&direction=descending`);
    expect(notion.sent.at(-1)?.body).toEqual({
      page_size: 50,
      sorts: [{ property: "Stage", direction: "descending" }],
      start_cursor: "cursor-2",
      filter: { property: "title", title: { contains: "Hel" } },
    });

    expect((await call(ctx, "GET", `${db}/pages?direction=sideways`)).status).toBe(400);
    expect((await call(ctx, "GET", `${db}/pages?search=${"x".repeat(201)}`)).status).toBe(400);
    ctx.db.close();
  });

  it("reads a page of this database only, never one in the trash or with a bad id", async () => {
    const { ctx, notion, db, page } = await setup("page");
    const body = (await (await call(ctx, "GET", page)).json()) as ContentPage;
    expect(body.title).toBe("Hello");
    expect(body.url).toBe("https://www.notion.so/Hello-0123456789abcdef0123456789abcdef");
    expect(body.properties[0]).toEqual({
      name: "Name",
      type: "title",
      value: { type: "title", text: "Hello" },
      display: "Hello",
    });
    expect(body.properties.find((p) => p.name === "Related")).toEqual({
      name: "Related",
      type: "relation",
      value: null,
      display: "2",
    });
    // Saving writes plain text, so text with styles says so.
    expect(body.properties.find((p) => p.name === "Note")?.formatted).toBe(true);
    expect(body.properties.find((p) => p.name === "Summary")?.formatted).toBeUndefined();
    expect(body.properties.find((p) => p.name === "Published")?.value).toEqual({
      type: "date",
      start: "2026-11-20",
      end: null,
    });

    notion.state.page = notionPage({ parent: { type: "database_id", database_id: OTHER_DB } });
    expect(await (await call(ctx, "GET", page)).json()).toMatchObject({ code: "content.not_in_database" });
    notion.state.page = notionPage({ archived: true });
    expect((await call(ctx, "GET", page)).status).toBe(404);
    notion.state.page = notionPage({ url: "https://evil.example/x" });
    expect(((await (await call(ctx, "GET", page)).json()) as ContentPage).url).toBeNull();

    const sentBefore = notion.sent.length;
    expect(await (await call(ctx, "GET", `${db}/pages/..%2Fusers`)).json()).toMatchObject({ code: "content.bad_id" });
    expect(notion.sent.length).toBe(sentBefore);
    ctx.db.close();
  });

  it("saves only the changed properties, refusing to overwrite a newer edit", async () => {
    const { ctx, notion, page } = await setup("update");
    const stale = await call(ctx, "PATCH", page, {
      lastEditedTime: "2026-11-21T07:00:00.000Z",
      properties: { Views: { type: "number", number: 8 } },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "content.conflict" });
    expect(notion.sent.some((s) => s.method === "PATCH")).toBe(false);

    const long = `${"a".repeat(1999)}😀${"b".repeat(10)}`;
    const res = await call(ctx, "PATCH", page, {
      lastEditedTime: "2026-11-21T08:00:00.000Z",
      properties: {
        Summary: { type: "rich_text", text: long },
        Tags: { type: "multi_select", options: ["a", "a", "c"] },
        Published: { type: "date", start: null, end: null },
        Stage: { type: "status", option: "Done" },
        Link: { type: "url", text: "  " },
      },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ContentPage).lastEditedTime).toBe("2026-11-21T09:00:00.000Z");
    const patch = notion.sent.find((s) => s.method === "PATCH");
    expect(patch?.body).toEqual({
      properties: {
        Summary: {
          rich_text: [
            { type: "text", text: { content: "a".repeat(1999) } },
            { type: "text", text: { content: `😀${"b".repeat(10)}` } },
          ],
        },
        Tags: { multi_select: [{ name: "a" }, { name: "c" }] },
        Published: { date: null },
        Stage: { status: { name: "Done" } },
        Link: { url: null },
      },
    });
    ctx.db.close();
  });

  it("accepts only the editable property types and Notion's limits", async () => {
    const { ctx, page, db } = await setup("validate");
    const send = (properties: unknown) =>
      call(ctx, "PATCH", page, { lastEditedTime: "2026-11-21T08:00:00.000Z", properties });
    expect((await send({ Related: { type: "relation", ids: ["x"] } })).status).toBe(400);
    expect((await send({ Name: { type: "title", text: "x".repeat(200_001) } })).status).toBe(400);
    expect((await send({ Tags: { type: "multi_select", options: ["a,b"] } })).status).toBe(400);
    expect((await send({ Published: { type: "date", start: "tomorrow", end: null } })).status).toBe(400);
    expect((await send({ Views: { type: "number", number: "7" } })).status).toBe(400);
    expect((await call(ctx, "POST", `${db}/pages`, { properties: {}, extra: 1 })).status).toBe(400);
    ctx.db.close();
  });

  it("creates a page in the database and moves one to the trash", async () => {
    const { ctx, notion, db, page } = await setup("create");
    const created = await call(ctx, "POST", `${db}/pages`, {
      properties: { Name: { type: "title", text: "New post" }, Featured: { type: "checkbox", checked: false } },
    });
    expect(created.status).toBe(200);
    expect(notion.sent.at(-1)).toMatchObject({
      method: "POST",
      path: "/pages",
      body: {
        parent: { database_id: DB },
        properties: {
          Name: { title: [{ type: "text", text: { content: "New post" } }] },
          Featured: { checkbox: false },
        },
      },
    });

    expect((await call(ctx, "DELETE", page)).status).toBe(204);
    expect(notion.sent.at(-1)).toMatchObject({ method: "PATCH", path: `/pages/${PAGE}`, body: { archived: true } });
    ctx.db.close();
  });

  it("explains Notion's failures, telling a missing write permission apart", async () => {
    const { ctx, notion, db, page } = await setup("errors");
    const codeOf = async (res: Promise<Response> | Response) => {
      const r = await res;
      return [r.status, ((await r.json()) as { code: string }).code];
    };
    const save = () =>
      call(ctx, "PATCH", page, {
        lastEditedTime: "2026-11-21T08:00:00.000Z",
        properties: { Views: { type: "number", number: 1 } },
      });

    notion.state.fail = { status: 401 };
    expect(await codeOf(call(ctx, "GET", db))).toEqual([503, "datasource.notion_unauthorized"]);
    notion.state.fail = { status: 404 };
    expect(await codeOf(call(ctx, "GET", db))).toEqual([503, "datasource.notion_not_shared"]);
    notion.state.fail = { status: 429 };
    expect(await codeOf(call(ctx, "GET", `${db}/pages`))).toEqual([503, "datasource.notion_rate_limited"]);
    notion.state.fail = { status: 403 };
    expect(await codeOf(call(ctx, "GET", db))).toEqual([503, "datasource.notion_forbidden"]);
    // Reading works, writing does not: the integration lacks Update content.
    notion.state.fail = { status: 403, when: (s) => s.method === "PATCH" };
    expect(await codeOf(save())).toEqual([403, "content.notion_write_forbidden"]);
    notion.state.fail = { status: 409, when: (s) => s.method === "PATCH" };
    expect(await codeOf(save())).toEqual([409, "content.conflict"]);
    notion.state.fail = {
      status: 400,
      body: {
        code: "validation_error",
        message: "Databases with multiple data sources are not supported in this API version.",
      },
    };
    expect(await codeOf(call(ctx, "GET", db))).toEqual([400, "content.notion_multi_source"]);
    notion.state.fail = {
      status: 400,
      body: { code: "validation_error", message: "Status option Done does not exist." },
    };
    expect(await codeOf(save())).toEqual([400, "content.notion_rejected"]);
    notion.state.fail = null;
    ctx.db.close();
  });

  it("refuses offline and for a source without a token", async () => {
    const ctx = makeApp({ appHome: path.join(base, "offline") });
    const source = (await (
      await call(ctx, "POST", "/api/data-sources", { platform: "notion", name: "Work", token: TOKEN })
    ).json()) as SavedDataSource;
    const res = await call(ctx, "GET", `/api/content/sources/${source.id}/databases/${DB}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "datasource.notion_offline" });
    expect((await call(ctx, "GET", `/api/content/sources/ds_missing/databases/${DB}`)).status).toBe(404);
    ctx.db.close();
  });

  it("spaces requests with one token out, at most three a second by default", async () => {
    const { ctx, notion, db } = await setup("throttle", { notionGapMs: 60 });
    const started = Date.now();
    await Promise.all([call(ctx, "GET", db), call(ctx, "GET", db), call(ctx, "GET", db)]);
    expect(notion.sent).toHaveLength(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(110);
    ctx.db.close();
  });
});

const p = (id: string, content: string) => ({
  id,
  type: "paragraph",
  has_children: false,
  paragraph: { rich_text: rich(content), color: "default" },
});
const hostedImage = (id: string, caption: string) => ({
  id,
  type: "image",
  has_children: false,
  image: { type: "file", file: { url: "https://s3.example/signed" }, caption: rich(caption) },
});
const ID = (n: number) => String(n).padStart(32, "a");

describe("/api/content page body", () => {
  it("reads the body as Markdown, list children included, or says why it cannot", async () => {
    const { ctx, notion, page } = await setup("body-read");
    notion.state.blocks = [
      p(ID(1), "Intro"),
      { id: ID(2), type: "bulleted_list_item", has_children: true, bulleted_list_item: { rich_text: rich("parent") } },
    ];
    notion.state.children[ID(2)] = [
      { id: ID(3), type: "to_do", has_children: false, to_do: { rich_text: rich("child"), checked: true } },
    ];
    const body = (await (await call(ctx, "GET", `${page}/body`)).json()) as ContentBody;
    expect(body).toEqual({
      markdown: "Intro\n\n- parent\n    - [x] child",
      editable: true,
      unsupported: [],
      lastEditedTime: "2026-11-21T08:00:00.000Z",
    });

    notion.state.blocks = [p(ID(1), "Intro"), { id: ID(4), type: "table", has_children: true, table: {} }];
    expect(await (await call(ctx, "GET", `${page}/body`)).json()).toMatchObject({
      markdown: "",
      editable: false,
      unsupported: ["children", "table"],
    });
    ctx.db.close();
  });

  it("replaces the whole body: new blocks first, in batches of 100, then the old ones go", async () => {
    const { ctx, notion, page } = await setup("body-save");
    notion.state.blocks = [p(ID(1), "Old one"), p(ID(2), "Old two")];
    const markdown = Array.from({ length: 250 }, (_, i) => `Paragraph ${i}`).join("\n\n");

    const stale = await call(ctx, "PUT", `${page}/body`, { lastEditedTime: "2026-11-21T07:00:00.000Z", markdown });
    expect(stale.status).toBe(409);
    expect(notion.sent.some((s) => s.method !== "GET")).toBe(false);

    const res = await call(ctx, "PUT", `${page}/body`, { lastEditedTime: "2026-11-21T08:00:00.000Z", markdown });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      markdown,
      editable: true,
      unsupported: [],
      lastEditedTime: "2026-11-21T09:00:00.000Z",
    });
    const writes = notion.sent.filter((s) => s.method !== "GET");
    expect(writes.map((s) => [s.method, s.path, (s.body?.children as unknown[] | undefined)?.length])).toEqual([
      ["PATCH", `/blocks/${PAGE}/children`, 100],
      ["PATCH", `/blocks/${PAGE}/children`, 100],
      ["PATCH", `/blocks/${PAGE}/children`, 50],
      ["DELETE", `/blocks/${ID(1)}`, undefined],
      ["DELETE", `/blocks/${ID(2)}`, undefined],
    ]);
    expect(writes[0]?.body?.after).toBeUndefined();
    ctx.db.close();
  });

  it("keeps a Notion-hosted image in place and writes around it", async () => {
    const { ctx, notion, page } = await setup("body-image");
    notion.state.blocks = [p(ID(1), "Old"), hostedImage(ID(2), "Cover"), p(ID(3), "Old after")];
    const res = await call(ctx, "PUT", `${page}/body`, {
      lastEditedTime: "2026-11-21T08:00:00.000Z",
      markdown: `New before\n\n![New caption](notion-image:${ID(2)})\n\nNew after`,
    });
    expect(res.status).toBe(200);
    const writes = notion.sent.filter((s) => s.method !== "GET");
    expect(writes.map((s) => [s.method, s.path, s.body?.after])).toEqual([
      ["PATCH", `/blocks/${PAGE}/children`, ID(1)],
      ["PATCH", `/blocks/${PAGE}/children`, ID(2)],
      ["PATCH", `/blocks/${ID(2)}`, undefined],
      ["DELETE", `/blocks/${ID(1)}`, undefined],
      ["DELETE", `/blocks/${ID(3)}`, undefined],
    ]);
    expect(writes[2]?.body).toMatchObject({ image: { caption: [{ text: { content: "New caption" } }] } });

    // Such an image cannot be added, moved, or have anything put before it when it comes first.
    const refuse = async (blocks: Record<string, unknown>[], markdown: string) => {
      notion.state.blocks = blocks;
      notion.state.page = notionPage();
      const r = await call(ctx, "PUT", `${page}/body`, { lastEditedTime: "2026-11-21T08:00:00.000Z", markdown });
      expect(await r.json()).toMatchObject({ code: "content.body_images" });
    };
    await refuse([p(ID(1), "x")], `![](notion-image:${ID(9)})`);
    await refuse(
      [hostedImage(ID(1), ""), hostedImage(ID(2), "")],
      `![](notion-image:${ID(2)})\n\n![](notion-image:${ID(1)})`,
    );
    await refuse([hostedImage(ID(1), "")], `Before\n\n![](notion-image:${ID(1)})`);
    ctx.db.close();
  });

  it("refuses to save over blocks it cannot write, and says when a save stopped half way", async () => {
    const { ctx, notion, page } = await setup("body-refuse");
    const save = () =>
      call(ctx, "PUT", `${page}/body`, { lastEditedTime: "2026-11-21T08:00:00.000Z", markdown: "New" });
    notion.state.blocks = [
      p(ID(1), "x"),
      { id: ID(2), type: "child_database", has_children: false, child_database: {} },
    ];
    const unsupported = await save();
    expect(unsupported.status).toBe(409);
    expect(await unsupported.json()).toMatchObject({ code: "content.body_unsupported" });
    expect(notion.sent.some((s) => s.method !== "GET")).toBe(false);

    notion.state.blocks = [p(ID(1), "x")];
    notion.state.fail = { status: 500, when: (s) => s.method === "DELETE" };
    expect(await (await save()).json()).toMatchObject({ code: "content.body_partial" });
    notion.state.fail = null;

    notion.state.page = notionPage();
    const invalid = await call(ctx, "PUT", `${page}/body`, {
      lastEditedTime: "2026-11-21T08:00:00.000Z",
      markdown: "![x](ftp://example.com/x.png)",
    });
    expect(await invalid.json()).toMatchObject({ code: "content.body_invalid" });
    ctx.db.close();
  });

  it("creates a page with its body", async () => {
    const { ctx, notion, db } = await setup("body-create");
    const markdown = Array.from({ length: 120 }, (_, i) => `- item ${i}`).join("\n");
    const res = await call(ctx, "POST", `${db}/pages`, { properties: {}, markdown });
    expect(res.status).toBe(200);
    const create = notion.sent.find((s) => s.method === "POST" && s.path === "/pages");
    expect(create?.body?.children).toHaveLength(100);
    const rest = notion.sent.at(-1);
    expect(rest).toMatchObject({ method: "PATCH", path: "/blocks/fedcba9876543210fedcba9876543210/children" });
    expect(rest?.body?.children).toHaveLength(20);
    expect(
      (await call(ctx, "POST", `${db}/pages`, { properties: {}, markdown: `![](notion-image:${ID(1)})` })).status,
    ).toBe(400);

    // Batches also stay under Notion's request size: 30 long paragraphs do not go in one request.
    notion.sent.length = 0;
    const long = Array.from({ length: 30 }, () => "z".repeat(15_000)).join("\n\n");
    expect((await call(ctx, "POST", `${db}/pages`, { properties: {}, markdown: long })).status).toBe(200);
    const sizes = notion.sent
      .filter((s) => s.method !== "GET")
      .map((s) => (s.body?.children as unknown[] | undefined)?.length ?? 0);
    expect(sizes.length).toBeGreaterThan(1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(30);
    ctx.db.close();
  });
});

describe("segments", () => {
  it("splits text at 2000 characters without breaking a surrogate pair", () => {
    expect(segments("")).toEqual([]);
    expect(segments("x".repeat(4000)).map((s) => (s.text as { content: string }).content.length)).toEqual([2000, 2000]);
    const parts = segments(`${"a".repeat(1999)}😀`);
    expect(parts.map((s) => (s.text as { content: string }).content)).toEqual(["a".repeat(1999), "😀"]);
  });
});
