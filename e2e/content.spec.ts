import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// Plan 5.6, content management C0: the third mode, its sidebar of Notion data sources and their databases.

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

test("content management lists the Notion data sources and opens a database", async ({ page, server }) => {
  await login(page, server);
  let listed = 0;
  await page.route("**/api/data-sources/*/notion/databases", (route) => {
    listed += 1;
    return route.fulfill({
      json: {
        databases: [
          { id: "db_posts", title: "Posts" },
          { id: "db_menu", title: "菜单 Menu" },
        ],
      },
    });
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
