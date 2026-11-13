import { expect, test } from "./fixtures.ts";
import { importSite, putSettings, removeImportedSites, startConversationButton } from "./site-helpers.ts";

// M3 layer 6 (plan 10.1, 10.2): conversations in the sidebar and the chat view, kept in step across tabs by
// the event stream. No model is chosen here, so sending a message shows agent.no_model.

test.afterAll(removeImportedSites);

test("a failed send keeps text typed while it was in flight", async ({ page, server }) => {
  await page.goto(await server.loginUrl());
  await putSettings(page, { model: null });
  const siteId = await importSite(page);
  await page.goto(`/sites/${siteId}`);
  await startConversationButton(page);

  // Hold the request so the second message is typed before the first one is refused.
  await page.route("**/api/sessions/*/messages", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  const input = page.getByTestId("composer-input");
  await input.fill("First message");
  await input.press("Enter");
  await input.fill("Second message");
  await expect(page.getByTestId("composer-error")).toHaveText(/model|模型/, { timeout: 20_000 });
  await expect(input).toHaveValue("Second message");
  await page.getByTestId("restore-failed-message").click();
  await expect(input).toHaveValue("First message");
});

test("conversations: start, send, rename and delete, with a second tab kept in step", async ({ page, server }) => {
  await page.goto(await server.loginUrl());
  // The server is shared by the project's tests; another one may have chosen a model.
  await putSettings(page, { model: null });
  const siteId = await importSite(page);
  await page.goto(`/sites/${siteId}`);
  await startConversationButton(page);
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/sessions/[0-9a-f]{16}$`));
  await expect(page.getByTestId("chat-view")).toBeVisible();
  const items = page.getByTestId("session-list").getByTestId("session-item");
  await expect(items).toHaveCount(1);

  // A second tab of the same browser shares the login and has its own event stream.
  const other = await page.context().newPage();
  await other.goto(`/sites/${siteId}`);
  await expect(other.getByTestId("session-list").getByTestId("session-item")).toHaveCount(1);

  // No model in end-to-end runs: the message is refused and stays in the box.
  const input = page.getByTestId("composer-input");
  await input.fill("Change the home page title");
  await input.press("Enter");
  await expect(page.getByTestId("composer-error")).toHaveText(/model|模型/, { timeout: 20_000 });
  await expect(input).toHaveValue("Change the home page title");
  // The first message names the conversation automatically, in both tabs.
  await expect(items).toHaveText("Change the home page title");
  await expect(other.getByTestId("session-list").getByTestId("session-item")).toHaveText("Change the home page title");

  // Rename from the session row's menu: shown here at once, and in the other tab through the event stream.
  const sessionId = new URL(page.url()).pathname.split("/").pop() ?? "";
  await page.getByTestId(`session-menu-${sessionId}`).click();
  await page.getByTestId("session-rename").click();
  await page.getByTestId("rename-input").fill("Home page title");
  await page.getByTestId("rename-save").click();
  await expect(items).toHaveText("Home page title");
  await expect(other.getByTestId("session-list").getByTestId("session-item")).toHaveText("Home page title");

  // A conversation started in the other tab shows up here.
  await other.getByTestId("new-session").click();
  await expect(other).toHaveURL(/\/sessions\/[0-9a-f]{16}$/);
  await expect(items).toHaveCount(2);

  // Delete from the session menu: back to the site home here, and gone from the other tab's list.
  await page.getByTestId(`session-menu-${sessionId}`).click();
  await page.getByTestId("session-delete").click();
  await page.getByTestId("delete-confirm").click();
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}$`));
  await expect(items).toHaveCount(1);
  await expect(other.getByTestId("session-list").getByTestId("session-item")).toHaveCount(1);
  await expect(other.getByTestId("session-list").getByTestId("session-item")).not.toHaveText("Home page title");
  await other.close();
});
