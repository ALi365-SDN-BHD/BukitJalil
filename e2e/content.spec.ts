import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { putSettings } from "./site-helpers.ts";

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
  body: unknown[];
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
        body: [{ type: "paragraph", text: [{ text: "Hello " }, { text: "world", bold: true }] }],
      },
      {
        id: "22222222222222222222222222222222",
        title: "Second post",
        stage: "Done",
        tags: [],
        featured: true,
        edited: "2026-11-20T08:00:00.000Z",
        body: [],
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
    // The database's AI conversations are the real server's.
    if (parts[7] === "sessions") return route.fallback();
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
        body: (body?.blocks as unknown[] | undefined) ?? [],
      };
      apply(created, (body?.properties ?? {}) as Record<string, Record<string, unknown>>);
      state.pages.unshift(created);
      return route.fulfill({ json: view(created) });
    }
    const found = state.pages.find((p) => p.id === pageId);
    if (!found) return route.fulfill({ status: 404, json: { code: "content.not_in_database" } });
    if (parts[9] === "body") {
      if (req.method() === "PUT") {
        found.body = (body?.blocks as unknown[] | undefined) ?? [];
        found.edited = new Date(Date.parse(found.edited) + 60_000).toISOString();
      }
      return route.fulfill({
        json: {
          blocks: found.readOnly ? [] : found.body,
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
  // The body is blocks: typing `- ` starts a list, as in Notion.
  const editor = page.getByTestId("content-body").locator('[contenteditable="true"]');
  await expect(editor.locator("strong")).toHaveText("world");
  // The caret goes after "world": End does not move to the line end in every browser on macOS.
  const word = await editor.locator("strong").boundingBox();
  await editor.locator("strong").click({ position: { x: (word?.width ?? 1) - 1, y: (word?.height ?? 2) / 2 } });
  await page.keyboard.press("Enter");
  await page.keyboard.type("- item");
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
    body: {
      lastEditedTime: "2026-11-21T08:00:00.000Z",
      blocks: [
        { type: "paragraph", text: [{ text: "Hello " }, { text: "world", bold: true }] },
        { type: "bulleted_list_item", text: [{ text: "item" }] },
      ],
    },
  });
  await expect(editor.locator("li, [data-content-type=bulletListItem]").first()).toContainText("item");
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

  // Nesting a paragraph cannot be saved: the editor says so, and what was typed survives a remount of the
  // editor (here by the narrow layout and back).
  const after = await editor.locator("strong").boundingBox();
  await editor.locator("strong").click({ position: { x: (after?.width ?? 1) - 1, y: (after?.height ?? 2) / 2 } });
  await page.keyboard.press("Enter");
  await page.keyboard.type("nested");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("content-body-problem")).toBeVisible();
  await expect(page.getByTestId("content-save")).toBeDisabled();
  const size = page.viewportSize();
  await page.setViewportSize({ width: 700, height: size?.height ?? 720 });
  await expect(page.getByTestId("content-body")).toBeVisible();
  await page.setViewportSize(size ?? { width: 1280, height: 720 });
  await expect(editor).toContainText("nested");
  await expect(page.getByTestId("content-body-problem")).toBeVisible();
  await editor.getByText("nested").click();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("content-body-problem")).toHaveCount(0);
  await expect(page.getByTestId("content-save")).toBeEnabled();

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
  await page.getByTestId("content-body").locator('[contenteditable="true"]').click();
  await page.keyboard.type("The third body");
  await page.getByTestId("content-property-Featured").getByRole("checkbox").check();
  await page.getByTestId("content-save").click();
  await expect(page).toHaveURL(new RegExp(`/databases/${DB}/pages/33333333333333333333333333333333$`));
  expect(notion.writes.at(-1)).toMatchObject({
    method: "POST",
    body: {
      properties: { Name: { type: "title", text: "Third post" }, Featured: { type: "checkbox", checked: true } },
      blocks: [{ type: "paragraph", text: [{ text: "The third body" }] }],
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

test("the AI assistant talks about the open entry, and writes a proposal only when confirmed", async ({
  page,
  server,
}) => {
  await login(page, server);
  await putSettings(page, { model: { provider: "bukitjalil-fake", id: "fake-1" } });
  const notion = await fakeContent(page, [{ id: DB, title: "Blog" }]);
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-nav-data").click();
  const id = await addSource(page, `Assistant ${Date.now()}`, "ntn_e2eassistanttoken12");
  await page.getByTestId("settings-close").click();
  await page.getByTestId("mode-content").click();
  await page.getByTestId(`content-source-${id}`).getByRole("button").click();
  await page.getByTestId(`content-database-${DB}`).click();
  const first = "11111111111111111111111111111111";
  await page.getByTestId("content-entry").filter({ hasText: "First post" }).click();
  await expect(page.getByTestId("content-title")).toHaveValue("First post");

  // Folded at first; open, it says the conversation goes to the model provider.
  const panel = page.getByTestId("content-ai");
  await expect(panel).toHaveAttribute("data-open", "false");
  await page.getByTestId("content-ai-toggle").click();
  await expect(page.getByTestId("content-ai-empty")).toContainText(/model provider|模型服务商/);
  await page.getByTestId("content-ai-new").click();

  // A message carries the open entry; the (fake) model answers through the real server.
  const sent: unknown[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/sessions\/[0-9a-f]+\/messages$/.test(r.url())) sent.push(r.postDataJSON());
  });
  // The e2e server has no Notion: the proposals the model would make are added to the stored conversation.
  const proposal = (callId: string, name: string, after: string) => [
    {
      entryId: `${callId}-call`,
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: callId, name: "propose_update", arguments: {} }],
        stopReason: "toolUse",
      },
    },
    {
      entryId: `${callId}-result`,
      message: {
        role: "toolResult",
        toolCallId: callId,
        toolName: "propose_update",
        isError: false,
        content: [{ type: "text", text: "recorded" }],
        details: {
          proposal: {
            kind: "update",
            entryId: first,
            title: "First post",
            base: "2026-11-21T08:00:00.000Z",
            properties: [{ name, type: "title", before: "First post", after: { type: "title", text: after } }],
            body: { before: "Hello **world**", after: "Hello **world**\n\nA new line." },
            blocks: [],
          },
        },
      },
    },
  ];
  const decided: string[] = [];
  await page.route(/\/api\/sessions\/[0-9a-f]+$/, async (route) => {
    const res = await route.fetch();
    const detail = (await res.json()) as { messages: unknown[] };
    if (detail.messages.length >= 2)
      detail.messages.push(...proposal("p1", "Name", "First post, revised"), ...proposal("p2", "Name", "Other"));
    await route.fulfill({ response: res, json: detail });
  });
  await page.route(/\/api\/sessions\/[0-9a-f]+\/proposals(\/.*)?$/, async (route) => {
    const url = route.request().url();
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    const [, callId, action] = /proposals\/([^/]+)\/(apply|reject)$/.exec(url) ?? [];
    decided.push(`${callId} ${action}`);
    if (action === "apply") {
      const p = notion.pages.find((x) => x.id === first);
      if (p) {
        p.title = "First post, revised";
        p.edited = "2026-11-21T09:00:00.000Z";
      }
    }
    return route.fulfill({
      json: {
        callId,
        status: action === "apply" ? "applied" : "rejected",
        entryId: action === "apply" ? first : null,
        error: null,
      },
    });
  });

  await page.getByTestId("composer-input").fill("Tighten the title of this entry");
  await page.getByTestId("send-message").click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ text: "Tighten the title of this entry", entryId: first });
  await expect(panel.getByTestId("message-assistant").first()).toContainText("Tighten the title of this entry");

  // Each proposal is a card: the property before and after, the body's changed lines.
  const cards = panel.getByTestId("proposal-card");
  await expect(cards).toHaveCount(2);
  const card = cards.first();
  await expect(card.getByTestId("proposal-properties")).toContainText("First post, revised");
  await expect(card.getByTestId("proposal-body")).toContainText("A new line.");

  // Not while the entry has unsaved edits.
  await page.getByTestId("content-title").fill("Edited by hand");
  await expect(card.getByTestId("proposal-apply")).toBeDisabled();
  // Also after leaving the entry: its unsaved edits are kept until it is saved or discarded.
  await page.getByTestId("content-back").click();
  await expect(page.getByTestId("content-entry").first()).toBeVisible();
  await expect(card.getByTestId("proposal-apply")).toBeDisabled();
  await page.getByTestId("content-entry").filter({ hasText: "First post" }).click();
  await page.getByTestId("content-title").fill("First post");
  await expect(card.getByTestId("proposal-apply")).toBeEnabled();

  await card.getByTestId("proposal-apply").click();
  await expect(card).toHaveAttribute("data-status", "applied");
  // The open entry shows what was written.
  await expect(page.getByTestId("content-title")).toHaveValue("First post, revised");
  await cards.nth(1).getByTestId("proposal-reject").click();
  await expect(cards.nth(1)).toHaveAttribute("data-status", "rejected");
  expect(decided).toEqual(["p1 apply", "p2 reject"]);
  // Nothing was written by the page itself: only the server writes a proposal.
  expect(notion.writes).toEqual([]);

  // Opened by Notion's dashed id, it is the same database with the same conversations.
  const dashed = `${DB.slice(0, 8)}-${DB.slice(8, 12)}-${DB.slice(12, 16)}-${DB.slice(16, 20)}-${DB.slice(20)}`;
  await page.goto(`/content/sources/${id}/databases/${dashed}`);
  await expect(page.getByTestId("content-ai-sessions")).toHaveValue(/^[0-9a-f]{16}$/);

  await page.unroute(/\/api\/sessions\/[0-9a-f]+$/);
  await removeSource(page, id);
  await putSettings(page, { model: null });
});
