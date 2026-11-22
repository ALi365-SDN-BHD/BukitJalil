import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// Plan 5.6, content management: the third mode, its sidebar of Notion data sources and their databases (C0),
// and the entries and properties of a database (C1). The e2e server is offline, so the content API is faked
// in the browser; the server side is covered by packages/server/test/content.test.ts.

async function login(page: Page, server: { loginUrl(): Promise<string> }) {
  await page.goto(await server.loginUrl());
  await expect(page.getByTestId("site-list")).toBeVisible();
}

/** Fill in a new Notion data source on the open data source settings; its id. */
async function addSource(page: Page, name: string, token: string): Promise<string> {
  await page.getByTestId("data-source-add").click();
  await page.getByTestId("data-source-name").fill(name);
  await page.getByTestId("data-source-token").fill(token);
  await page.getByTestId("data-source-save").click();
  const row = page.getByTestId(/^data-source-ds_[0-9a-f]{12}$/).filter({ hasText: name });
  await expect(row).toBeVisible();
  return (await row.getAttribute("data-testid"))?.replace("data-source-", "") ?? "";
}

/** The worker's server is shared: other specs expect no data sources, so each test removes its own. */
async function removeSource(page: Page, id: string) {
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-nav-data").click();
  await page.getByTestId(`data-source-delete-${id}`).click();
  await page.getByTestId(`data-source-delete-confirm-${id}`).click();
  await expect(page.getByTestId(`data-source-${id}`)).toHaveCount(0);
  await page.getByTestId("settings-close").click();
}

const DB = "1a2b3c4d5e6f40718293a4b5c6d7e8f9";

interface FakePage {
  id: string;
  title: string;
  stage: string | null;
  tags: string[];
  featured: boolean;
  edited: string;
  body: string;
  /** The body has blocks that cannot be edited here. */
  readOnly?: boolean;
}

/**
 * The content API of one database, answered in the browser. `fail` makes the next write answer with an error
 * code instead.
 */
async function fakeContent(page: Page, databases: { id: string; title: string }[]) {
  const state = {
    pages: [
      {
        id: "11111111111111111111111111111111",
        title: "First post",
        stage: "Draft",
        tags: ["news"],
        featured: false,
        edited: "2026-11-21T08:00:00.000Z",
        body: "Hello **world**",
      },
      {
        id: "22222222222222222222222222222222",
        title: "Second post",
        stage: "Done",
        tags: [],
        featured: true,
        edited: "2026-11-20T08:00:00.000Z",
        body: "",
        readOnly: true,
      },
    ] as FakePage[],
    writes: [] as { method: string; path: string; body: unknown }[],
    queries: [] as string[],
    fail: null as null | { status: number; code: string },
  };
  const view = (p: FakePage) => ({
    id: p.id,
    databaseId: DB,
    title: p.title,
    url: `https://www.notion.so/${p.id}`,
    lastEditedTime: p.edited,
    properties: [
      { name: "Name", type: "title", value: { type: "title", text: p.title }, display: p.title },
      {
        name: "Featured",
        type: "checkbox",
        value: { type: "checkbox", checked: p.featured },
        display: p.featured ? "✓" : "",
      },
      { name: "Order", type: "number", value: { type: "number", number: 5 }, display: "5" },
      { name: "Related", type: "relation", value: null, display: "2" },
      { name: "Stage", type: "status", value: { type: "status", option: p.stage }, display: p.stage ?? "" },
      {
        name: "Tags",
        type: "multi_select",
        value: { type: "multi_select", options: p.tags },
        display: p.tags.join(", "),
      },
    ],
  });
  const apply = (p: FakePage, properties: Record<string, Record<string, unknown>>) => {
    for (const [name, value] of Object.entries(properties)) {
      if (name === "Name") p.title = String(value.text);
      if (name === "Stage") p.stage = (value.option as string | null) ?? null;
      if (name === "Tags") p.tags = value.options as string[];
      if (name === "Featured") p.featured = value.checked === true;
    }
    p.edited = new Date(Date.parse(p.edited) + 60_000).toISOString();
  };
  await page.route("**/api/data-sources/*/notion/databases", (route) => route.fulfill({ json: { databases } }));
  await page.route("**/api/content/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const parts = url.pathname.split("/");
    const pageId = parts[8];
    const body = req.postData() ? (JSON.parse(req.postData() ?? "{}") as Record<string, unknown>) : null;
    if (req.method() !== "GET") {
      state.writes.push({ method: req.method(), path: url.pathname, body });
      if (state.fail) {
        const { status, code } = state.fail;
        state.fail = null;
        return route.fulfill({ status, json: { code } });
      }
    }
    if (parts.length === 7) {
      return route.fulfill({
        json: {
          id: parts[6],
          title: databases.find((d) => d.id === parts[6])?.title ?? "",
          url: null,
          propertiesTruncated: false,
          properties: [
            { name: "Name", type: "title", editable: true },
            { name: "Featured", type: "checkbox", editable: true },
            { name: "Related", type: "relation", editable: false },
            {
              name: "Stage",
              type: "status",
              editable: true,
              options: [
                { name: "Draft", color: "gray" },
                { name: "Done", color: "green" },
              ],
            },
            {
              name: "Tags",
              type: "multi_select",
              editable: true,
              options: [
                { name: "news", color: "red" },
                { name: "guide", color: "blue" },
              ],
            },
          ],
        },
      });
    }
    if (pageId === undefined && req.method() === "GET") {
      state.queries.push(url.search);
      const search = url.searchParams.get("search") ?? "";
      const entries = state.pages
        .filter((p) => p.title.includes(search))
        .map((p) => ({
          id: p.id,
          title: p.title,
          url: null,
          lastEditedTime: p.edited,
          cells: { Stage: p.stage ?? "", Tags: p.tags.join(", ") },
        }));
      return route.fulfill({ json: { entries, nextCursor: null } });
    }
    if (pageId === undefined) {
      const created: FakePage = {
        id: "33333333333333333333333333333333",
        title: "",
        stage: null,
        tags: [],
        featured: false,
        edited: "2026-11-21T10:00:00.000Z",
        body: String(body?.markdown ?? ""),
      };
      apply(created, (body?.properties ?? {}) as Record<string, Record<string, unknown>>);
      state.pages.unshift(created);
      return route.fulfill({ json: view(created) });
    }
    const found = state.pages.find((p) => p.id === pageId);
    if (!found) return route.fulfill({ status: 404, json: { code: "content.not_in_database" } });
    if (parts[9] === "body") {
      if (req.method() === "PUT") {
        found.body = String(body?.markdown ?? "");
        found.edited = new Date(Date.parse(found.edited) + 60_000).toISOString();
      }
      return route.fulfill({
        json: {
          markdown: found.readOnly ? "" : found.body,
          editable: !found.readOnly,
          unsupported: found.readOnly ? ["breadcrumb_v2", "color", "table"] : [],
          lastEditedTime: found.edited,
        },
      });
    }
    if (req.method() === "DELETE") {
      state.pages = state.pages.filter((p) => p !== found);
      return route.fulfill({ status: 204 });
    }
    if (req.method() === "PATCH") apply(found, (body?.properties ?? {}) as Record<string, Record<string, unknown>>);
    return route.fulfill({ json: view(found) });
  });
  return state;
}

test("content management lists the Notion data sources and opens a database", async ({ page, server }) => {
  await login(page, server);
  await fakeContent(page, [
    { id: "db_posts", title: "Posts" },
    { id: "db_menu", title: "菜单 Menu" },
  ]);
  let listed = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/notion/databases")) listed += 1;
  });

  // The switch has three segments; the add button leads to the data source settings.
  await page.getByTestId("mode-content").click();
  await expect(page).toHaveURL(/\/content$/);
  await expect(page.getByTestId("mode-content")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("content-welcome")).toBeVisible();
  await expect(page.getByTestId("content-properties")).toBeVisible();
  await page.getByTestId("content-add-source").click();
  await expect(page).toHaveURL(/\/settings\?section=data$/);

  const name = `Content ${Date.now()}`;
  const id = await addSource(page, name, "ntn_e2econtenttoken9876");
  await page.getByTestId("settings-close").click();
  await expect(page).toHaveURL(/\/content$/);

  // Entering the mode reads only the local list; Notion is called when a source is opened.
  const source = page.getByTestId(`content-source-${id}`);
  await expect(source).toContainText(name);
  expect(listed).toBe(0);
  await source.getByRole("button").click();
  await expect(page.getByTestId(`content-databases-${id}`)).toContainText("菜单 Menu");
  expect(listed).toBe(1);

  await page.getByTestId("content-database-db_posts").click();
  await expect(page).toHaveURL(new RegExp(`/content/sources/${id}/databases/db_posts$`));
  await expect(page.getByTestId("content-database")).toContainText("Posts");
  await expect(page.getByTestId("content-database-db_posts")).toHaveAttribute("aria-current", "page");

  // Each mode keeps its last place; coming back opens the database's source again.
  await page.getByTestId("mode-site").click();
  await expect(page.getByTestId("site-list")).toBeVisible();
  await page.getByTestId("mode-content").click();
  await expect(page).toHaveURL(new RegExp(`/content/sources/${id}/databases/db_posts$`));
  await expect(page.getByTestId("content-database")).toContainText("Posts");
  await expect(page.getByTestId("content-database-db_posts")).toHaveAttribute("aria-current", "page");

  // Narrow screens name the columns after the mode's parts.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByTestId("column-sites")).toHaveText(/Notion/);
  await expect(page.getByTestId("column-panels")).toHaveText(/Properties|属性/);
  await page.setViewportSize({ width: 1280, height: 800 });
  await removeSource(page, id);
});

test("a database list that cannot be read explains why", async ({ page, server }) => {
  await login(page, server);
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-nav-data").click();
  const id = await addSource(page, `Offline ${Date.now()}`, "ntn_e2eofflinetoken1234");
  await page.getByTestId("settings-close").click();

  // The e2e server is offline, so listing the databases fails with that reason.
  await page.getByTestId("mode-content").click();
  await page.getByTestId(`content-source-${id}`).getByRole("button").click();
  await expect(page.getByTestId(`content-source-${id}`).getByTestId("content-databases-error")).toContainText(
    /offline|离线/,
  );

  // A database address whose data source no longer exists shows the welcome.
  await page.goto("/content/sources/ds_000000000000/databases/db_gone");
  await expect(page.getByTestId("content-welcome")).toBeVisible();
  await removeSource(page, id);
});

test("entries are listed, edited, created and moved to the trash", async ({ page, server }) => {
  await login(page, server);
  const notion = await fakeContent(page, [{ id: DB, title: "Blog" }]);
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-nav-data").click();
  const id = await addSource(page, `Entries ${Date.now()}`, "ntn_e2eentriestoken1234");
  await page.getByTestId("settings-close").click();
  await page.getByTestId("mode-content").click();
  await page.getByTestId(`content-source-${id}`).getByRole("button").click();
  await page.getByTestId(`content-database-${DB}`).click();

  // The list, newest first, with the database's columns; the right column has its fields.
  const entries = page.getByTestId("content-entry");
  await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText("First post");
  await expect(entries.first()).toContainText("Draft");
  await expect(page.getByTestId("content-fields")).toContainText("Related");
  await expect(page.getByTestId("content-database-info")).toContainText(/No site uses|还没有网站/);

  await page.getByTestId("content-search").fill("Second");
  await page.getByTestId("content-search").press("Enter");
  await expect(entries).toHaveCount(1);
  expect(notion.queries.at(-1)).toContain("search=Second");
  await page.getByTestId("content-sort").selectOption("Stage");
  await expect.poll(() => notion.queries.at(-1)).toContain("sort=Stage");
  await page.getByTestId("content-search").fill("");
  await page.getByTestId("content-search").press("Enter");
  await expect(entries).toHaveCount(2);

  // Open an entry: the title in the middle, the properties on the right; one save sends the changes.
  await entries.filter({ hasText: "First post" }).click();
  await expect(page).toHaveURL(new RegExp(`/databases/${DB}/pages/11111111111111111111111111111111$`));
  await expect(page.getByTestId("content-title")).toHaveValue("First post");
  await expect(page.getByTestId("content-save")).toBeDisabled();
  await expect(page.getByTestId("content-property-Related")).toContainText(/2 related|2 个关联/);
  await expect(page.getByTestId("content-body")).toHaveValue("Hello **world**");
  await page.getByTestId("content-body").fill("Hello **body**\n\n- item");
  // A body change alone is something to save.
  await expect(page.getByTestId("content-save")).toBeEnabled();
  await page.getByTestId("content-title").fill("First post, edited");
  await page.getByTestId("content-property-Stage").getByRole("combobox").selectOption("Done");
  await page.getByTestId("content-property-Tags").getByRole("button", { name: "guide" }).click();
  // A number field keeps a half-typed `-` instead of clearing it.
  const order = page.getByTestId("content-property-Order").getByRole("textbox");
  await expect(order).toHaveValue("5");
  await order.fill("");
  await order.pressSequentially("-3");
  await expect(order).toHaveValue("-3");
  await page.getByTestId("content-save").click();
  await expect(page.getByTestId("content-saved")).toBeVisible();
  await expect(page.getByTestId("content-save")).toBeDisabled();
  // The body goes first; the property save checks the edit time the body save returned.
  expect(notion.writes.at(-2)).toMatchObject({
    method: "PUT",
    body: { lastEditedTime: "2026-11-21T08:00:00.000Z", markdown: "Hello **body**\n\n- item" },
  });
  await expect(page.getByTestId("content-body")).toHaveValue("Hello **body**\n\n- item");
  expect(notion.writes.at(-1)).toMatchObject({
    method: "PATCH",
    body: {
      lastEditedTime: "2026-11-21T08:01:00.000Z",
      properties: {
        Name: { type: "title", text: "First post, edited" },
        Stage: { type: "status", option: "Done" },
        Order: { type: "number", number: -3 },
        Tags: { type: "multi_select", options: ["news", "guide"] },
      },
    },
  });

  // Someone else edited it in Notion: the save is refused, and reloading drops the unsaved change.
  notion.fail = { status: 409, code: "content.conflict" };
  await page.getByTestId("content-property-Featured").getByRole("checkbox").check();
  await page.getByTestId("content-save").click();
  await expect(page.getByTestId("content-save-error")).toContainText(/changed after you opened|被修改过/);
  await page.getByTestId("content-reload").click();
  await expect(page.getByTestId("content-property-Featured").getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByTestId("content-save")).toBeDisabled();

  // An integration without write permission says what to turn on.
  notion.fail = { status: 403, code: "content.notion_write_forbidden" };
  await page.getByTestId("content-property-Featured").getByRole("checkbox").check();
  await page.getByTestId("content-save").click();
  await expect(page.getByTestId("content-save-error")).toContainText("Update content");
  await page.getByTestId("content-property-Featured").getByRole("checkbox").uncheck();

  // A new entry: created in Notion, then opened at its own address.
  await page.getByTestId("content-back").click();
  await page.getByTestId("content-new-entry").click();
  await expect(page).toHaveURL(new RegExp(`/databases/${DB}/pages/new$`));
  await expect(page.getByTestId("content-property-Related")).toHaveCount(0);
  await page.getByTestId("content-title").fill("Third post");
  await page.getByTestId("content-body").fill("The third body");
  await page.getByTestId("content-property-Featured").getByRole("checkbox").check();
  await page.getByTestId("content-save").click();
  await expect(page).toHaveURL(new RegExp(`/databases/${DB}/pages/33333333333333333333333333333333$`));
  expect(notion.writes.at(-1)).toMatchObject({
    method: "POST",
    body: {
      properties: { Name: { type: "title", text: "Third post" }, Featured: { type: "checkbox", checked: true } },
      markdown: "The third body",
    },
  });
  await expect(page.getByTestId("content-title")).toHaveValue("Third post");

  // Moving it to the trash asks first, then goes back to the list without it.
  await page.getByTestId("content-trash").click();
  await page.getByTestId("content-trash-confirm").click();
  await expect(page).toHaveURL(new RegExp(`/databases/${DB}$`));
  expect(notion.writes.at(-1)).toMatchObject({ method: "DELETE" });
  await expect(entries).toHaveCount(2);
  await expect(page.getByTestId("content-entries")).not.toContainText("Third post");

  // A body with blocks this cannot write is read-only, with a way to Notion; the reasons are named, and a block
  // type without a name keeps its code. The browser picks the UI language, so either list is right.
  await entries.filter({ hasText: "Second post" }).click();
  await expect(page.getByTestId("content-body-readonly")).toContainText(
    /（其他块（breadcrumb_v2）、文字或背景颜色和表格）|\(other blocks \(breadcrumb_v2\), text or background color, and tables\)/,
  );
  await expect(page.getByTestId("content-body")).toHaveCount(0);

  await removeSource(page, id);
});

test("settings lead to content management, and a narrow screen edits an entry column by column", async ({
  page,
  server,
}) => {
  await login(page, server);
  const notion = await fakeContent(page, [{ id: DB, title: "Blog" }]);
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-nav-data").click();
  const id = await addSource(page, `Narrow ${Date.now()}`, "ntn_e2enarrowtoken1234");

  // The data source settings point to where the pages of the sources are edited.
  await page.getByTestId("data-source-open-content").click();
  await expect(page).toHaveURL(/\/content$/);
  await expect(page.getByTestId("mode-content")).toHaveAttribute("aria-selected", "true");

  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByTestId("column-sites").click();
  await page.getByTestId(`content-source-${id}`).getByRole("button").click();
  await page.getByTestId(`content-database-${DB}`).click();
  // Opening a database shows its entries; opening an entry keeps the middle column.
  await expect(page.getByTestId("column-conversation")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("content-entry").filter({ hasText: "First post" }).click();
  await expect(page.getByTestId("content-title")).toBeVisible();
  await expect(page.getByTestId("content-page")).toContainText(/cannot be undone|不能在 BukitJalil 里撤销/);

  // The properties are their own column; the save in the middle column sends what was changed there.
  await page.getByTestId("column-panels").click();
  await page.getByTestId("content-property-Stage").getByRole("combobox").selectOption("Done");
  await page.getByTestId("column-conversation").click();
  await page.getByTestId("content-save").click();
  await expect(page.getByTestId("content-saved")).toBeVisible();
  expect(notion.writes.at(-1)).toMatchObject({
    method: "PATCH",
    body: { properties: { Stage: { type: "status", option: "Done" } } },
  });

  // Moving to the trash says it cannot be undone here.
  await page.getByTestId("column-panels").click();
  await page.getByTestId("content-trash").click();
  await expect(page.getByRole("dialog")).toContainText(/cannot be undone in BukitJalil|BukitJalil 里不能撤销/);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Cancel|取消/ })
    .click();

  await page.setViewportSize({ width: 1280, height: 800 });
  await removeSource(page, id);
});
