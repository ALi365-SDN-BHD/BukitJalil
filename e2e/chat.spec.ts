import { expect, test } from "./fixtures.ts";
import { importSite, putSettings, removeImportedSites, startConversationButton } from "./site-helpers.ts";

// M3 layer 6 (plan 10.1, 10.2): conversations in the sidebar and the chat view, kept in step across tabs by
// the event stream. No model is chosen here, so sending a message shows agent.no_model.

test.afterAll(removeImportedSites);

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

  // Rename: shown here at once, and in the other tab through the event stream.
  await page.getByTestId("rename-session").click();
  await page.getByTestId("rename-input").fill("Home page title");
  await page.getByTestId("rename-save").click();
  await expect(page.getByTestId("chat-title")).toHaveText("Home page title");
  await expect(other.getByTestId("session-list").getByTestId("session-item")).toHaveText("Home page title");

  // A conversation started in the other tab shows up here.
  await other.getByTestId("new-session").click();
  await expect(other).toHaveURL(/\/sessions\/[0-9a-f]{16}$/);
  await expect(items).toHaveCount(2);

  // Delete: back to the site home here, and gone from the other tab's list.
  await page.getByTestId("delete-session").click();
  await page.getByTestId("delete-confirm").click();
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}$`));
  await expect(items).toHaveCount(1);
  await expect(other.getByTestId("session-list").getByTestId("session-item")).toHaveCount(1);
  await expect(other.getByTestId("session-list").getByTestId("session-item")).not.toHaveText("Home page title");
  await other.close();
});
