import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NotionDatabasesResponse, SavedDataSource } from "@bukitjalil/shared";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ADMIN, makeApp, req } from "./helpers.ts";

// Saved Notion sources (plan 6.5): Markdown is the built-in default, so only Notion tokens are
// stored here. Nothing calls the real Notion API in these tests.

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-data-sources-")));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const call = (ctx: ReturnType<typeof makeApp>, method: string, p: string, body?: unknown) =>
  ctx.app.fetch(
    req(p, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
    }),
  );

const list = async (ctx: ReturnType<typeof makeApp>) =>
  (await (await call(ctx, "GET", "/api/data-sources")).json()) as SavedDataSource[];

const notion = (name: string, token = "ntn_exampleexample1234") => ({
  platform: "notion" as const,
  name,
  token,
});

const identity = (ctx: ReturnType<typeof makeApp>) =>
  ctx.db
    .prepare("INSERT OR REPLACE INTO settings (key, value_json) VALUES ('commitName', ?), ('commitEmail', ?)")
    .run(JSON.stringify("Site Owner"), JSON.stringify("owner@example.com"));

describe("/api/data-sources", () => {
  it("starts empty and saves, edits and removes Notion sources", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app-notion-crud") });
    expect(await list(ctx)).toEqual([]);

    // Markdown is the built-in default and cannot be saved as a data source.
    const markdownRes = await call(ctx, "POST", "/api/data-sources", {
      platform: "markdown",
      name: "Posts",
      dir: "content/posts",
      mode: "content",
      collection: "post",
    });
    expect(markdownRes.status).toBe(400);

    const createdRes = await call(ctx, "POST", "/api/data-sources", notion("Work Notion"));
    expect(createdRes.status).toBe(200);
    const created = (await createdRes.json()) as SavedDataSource;
    expect(created).toMatchObject({
      name: "Work Notion",
      platform: "notion",
      hasToken: true,
      tokenLast4: "1234",
    });
    expect(created.id).toMatch(/^ds_[0-9a-f]{12}$/);
    expect(JSON.stringify(created)).not.toContain("ntn_example");

    expect((await call(ctx, "POST", "/api/data-sources", notion("work notion"))).status).toBe(409);
    expect((await call(ctx, "POST", "/api/data-sources", { platform: "notion", name: "No token" })).status).toBe(400);

    // Editing the name without a token keeps the saved one.
    const updated = (await (
      await call(ctx, "PUT", `/api/data-sources/${created.id}`, { platform: "notion", name: "Company Notion" })
    ).json()) as SavedDataSource;
    expect(updated).toMatchObject({ id: created.id, name: "Company Notion", hasToken: true });
    expect(ctx.dataSources.token(created.id)).toBe("ntn_exampleexample1234");

    expect((await call(ctx, "DELETE", `/api/data-sources/${created.id}`)).status).toBe(204);
    expect(await list(ctx)).toEqual([]);
    ctx.db.close();
  });

  it("removes token entries whose data source no longer exists", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app-notion-orphan") });
    const created = (await (await call(ctx, "POST", "/api/data-sources", notion("Kept"))).json()) as SavedDataSource;
    const file = ctx.paths.dataSourceTokens;
    const tokens = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    tokens.ds_000000000000 = "ntn_orphan123456";
    fs.writeFileSync(file, JSON.stringify(tokens), { mode: 0o600 });

    expect(ctx.dataSources.pruneUnknownTokens()).toBe(1);
    expect(ctx.dataSources.token(created.id)).toBe("ntn_exampleexample1234");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).not.toHaveProperty("ds_000000000000");
    ctx.db.close();
  });

  it("lists the databases its token can read", async () => {
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { filter: unknown };
      expect(body.filter).toEqual({ value: "database", property: "object" });
      return new Response(
        JSON.stringify({
          object: "list",
          results: [
            { object: "database", id: "db_blog", title: [{ plain_text: "Blog" }] },
            { object: "database", id: "db_docs", title: [{ plain_text: "Docs" }] },
          ],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const ctx = makeApp({ appHome: path.join(base, "app-notion-databases"), dataSourceFetch: fetchImpl });

    const created = (await (
      await call(ctx, "POST", "/api/data-sources", notion("Work Notion"))
    ).json()) as SavedDataSource;
    expect(fs.statSync(ctx.paths.dataSourceTokens).mode & 0o777).toBe(0o600);

    const databases = (await (
      await call(ctx, "GET", `/api/data-sources/${created.id}/notion/databases`)
    ).json()) as NotionDatabasesResponse;
    expect(databases.databases).toEqual([
      { id: "db_blog", title: "Blog" },
      { id: "db_docs", title: "Docs" },
    ]);
    ctx.db.close();
  });

  it("refuses to list databases offline", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app-offline") });
    const created = (await (
      await call(ctx, "POST", "/api/data-sources", notion("Offline Notion", "ntn_offline1234"))
    ).json()) as SavedDataSource;
    const res = await call(ctx, "GET", `/api/data-sources/${created.id}/notion/databases`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "datasource.notion_offline" });
    ctx.db.close();
  });
});

describe("new site data sources", () => {
  it("uses the starter's Markdown sources and creates Markdown files when none is picked", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app-markdown-default") });
    identity(ctx);
    const dir = path.join(base, "site-markdown-default");
    await ctx.sites.create({ name: "Markdown", path: dir, language: "en-US" });

    const yaml = fs.readFileSync(path.join(dir, "site.yaml"), "utf8");
    expect(yaml).toContain("dir: content/posts");
    expect(yaml).toContain("dir: content/pages");
    expect(yaml).toContain("dir: data");
    expect(fs.existsSync(path.join(dir, "content/posts/welcome.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "content/pages/about.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "data/features-10.md"))).toBe(true);
    await ctx.builds.settled();
    ctx.db.close();
  });

  it("puts the picked Notion databases in site.yaml and keeps the token linked", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app-site") });
    identity(ctx);
    const source = (await (
      await call(ctx, "POST", "/api/data-sources", notion("Work Notion"))
    ).json()) as SavedDataSource;
    const dir = path.join(base, "site-sources");
    const site = await ctx.sites.create({
      name: "Sources",
      path: dir,
      language: "en-US",
      dataSourceIds: [source.id],
      notionDatabases: [
        { databaseId: "db_blog", title: "Blog", use: "post" },
        { databaseId: "db_docs", title: "文章 Docs", use: "page" },
        { databaseId: "db_settings", title: "Site Settings", use: "data" },
        { databaseId: "db_blog_2024", title: "2024 Blog", use: "post" },
      ],
    });

    const yaml = fs.readFileSync(path.join(dir, "site.yaml"), "utf8");
    expect((parse(yaml) as { content: { sources: unknown } }).content.sources).toEqual([
      { type: "notion", name: "blog", mode: "content", collection: "post", notion: { databaseId: "db_blog" } },
      { type: "notion", name: "docs", mode: "content", collection: "page", notion: { databaseId: "db_docs" } },
      { type: "notion", name: "site_settings", mode: "data", notion: { databaseId: "db_settings" } },
      // Names start with a letter and stay unique: "2024 Blog" slugs to "blog", which is taken.
      { type: "notion", name: "blog_2", mode: "content", collection: "post", notion: { databaseId: "db_blog_2024" } },
    ]);
    expect(yaml).not.toContain("dir: content/posts");
    expect(fs.existsSync(path.join(dir, "content/posts/welcome.md"))).toBe(true);
    expect(ctx.sites.notionDataSourceId(site.id)).toBe(source.id);
    await ctx.builds.settled();

    // The Notion source is in use and cannot be deleted while the site exists.
    const res = await call(ctx, "DELETE", `/api/data-sources/${source.id}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "datasource.in_use", params: { count: "1" } });
    ctx.db.close();
  });

  it("allows one Notion source at most and requires its database", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app-limits") });
    identity(ctx);
    const first = (await (
      await call(ctx, "POST", "/api/data-sources", notion("First", "ntn_first1234"))
    ).json()) as SavedDataSource;
    const second = (await (
      await call(ctx, "POST", "/api/data-sources", notion("Second", "ntn_second1234"))
    ).json()) as SavedDataSource;

    await expect(
      ctx.sites.create({
        name: "Two",
        path: path.join(base, "site-two"),
        language: "en-US",
        dataSourceIds: [first.id, second.id],
        notionDatabases: [{ databaseId: "db", title: "Blog", use: "post" }],
      }),
    ).rejects.toMatchObject({ code: "datasource.multiple_notion" });

    await expect(
      ctx.sites.create({
        name: "No database",
        path: path.join(base, "site-no-db"),
        language: "en-US",
        dataSourceIds: [first.id],
      }),
    ).rejects.toMatchObject({ code: "datasource.notion_database_required" });

    // An empty choice means Markdown, not an error.
    const dir = path.join(base, "site-empty-choice");
    await ctx.sites.create({ name: "Default", path: dir, language: "en-US", dataSourceIds: [] });
    expect(fs.readFileSync(path.join(dir, "site.yaml"), "utf8")).toContain("dir: content/posts");
    await ctx.builds.settled();
    ctx.db.close();
  });
});
