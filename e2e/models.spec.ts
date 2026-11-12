import { expect, test } from "./fixtures.ts";
import { importSite, putSettings, removeImportedSites, startConversationButton } from "./site-helpers.ts";

// M3 layer 7 (plan 6.5, 10.1): model settings, then a conversation that streams. The server runs with the
// scripted model (BUKITJALIL_FAKE_MODEL=1, packages/server/src/agent/fake-model.ts), so nothing leaves the
// machine; the key saved for a real provider is a made-up test value and is never used.

test.afterAll(removeImportedSites);

test("model settings: save and remove a key, test the connection, choose the model, watch a reply stream", async ({
  page,
  server,
}) => {
  await page.goto(await server.loginUrl());
  await putSettings(page, { model: null });
  const siteId = await importSite(page, "Models");
  await page.goto(`/sites/${siteId}`);

  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-nav-model").click();
  const section = page.getByTestId("model-section");
  await expect(section.getByTestId("model-current")).toHaveText(/No model|还没有选择/);

  // A subscription provider offers the native OAuth sign-in before an API key is needed.
  await section.getByTestId("model-provider-anthropic").click();
  await expect(section.getByTestId("provider-oauth-sign-in")).toBeVisible();
  await section.getByTestId("model-back").click();

  // A real provider: the key is saved, shown only by its last four characters, then removed.
  await section.getByTestId("model-provider-cerebras").click();
  await expect(section.getByTestId("model-key-status")).toHaveText(/No API key|还没有 API Key/);
  await expect(section.getByTestId("model-test")).toBeDisabled();
  await section.getByTestId("model-key-input").fill("csk-e2e-made-up-test-key-abcd");
  await section.getByTestId("model-key-save").click();
  await expect(section.getByTestId("model-key-status")).toHaveText(/abcd/);
  await expect(section.getByTestId("model-key-input")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("csk-e2e-made-up");
  await section.getByTestId("model-key-remove").click();
  await expect(section.getByTestId("model-key-status")).toHaveText(/No API key|还没有 API Key/);

  // The scripted model needs no key: test it, then use it.
  await section.getByTestId("model-back").click();
  await section.getByTestId("model-provider-bukitjalil-fake").click();
  await expect(section.getByTestId("model-id")).toHaveValue("fake-1");
  await section.getByTestId("model-test").click();
  await expect(section.getByTestId("model-test-result")).toHaveText(/Connected|连接成功/);
  await section.getByTestId("model-use").click();
  await expect(section.getByTestId("model-current")).toHaveText(/BukitJalil fake model/);
  await expect(section.getByTestId("model-use")).toBeDisabled();
  await page.getByTestId("settings-close").click();
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}$`));

  // A conversation: the reply streams in, the tool card fills in, the run ends without an error.
  await startConversationButton(page);
  const input = page.getByTestId("composer-input");
  await input.fill("Change the home page title");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(page.getByTestId("message-user")).toContainText("Change the home page title");
  await expect(page.getByTestId("message-streaming")).toBeVisible({ timeout: 15_000 });
  const card = page.getByTestId("tool-card");
  await expect(card).toHaveAttribute("data-tool", "site_info");
  await expect(card).toHaveAttribute("data-state", "ok", { timeout: 15_000 });
  const replies = page.getByTestId("message-assistant");
  await expect(replies.last()).toContainText("You asked: Change the home page title", { timeout: 15_000 });
  await expect(page.getByTestId("chat-status")).toHaveCount(0);
  await expect(page.getByTestId("message-streaming")).toHaveCount(0);
  await expect(page.getByTestId("chat-error")).toHaveCount(0);

  // After a reload the conversation comes back from the session file.
  await page.reload();
  await expect(page.getByTestId("message-user")).toContainText("Change the home page title");
  await expect(page.getByTestId("message-assistant").last()).toContainText("You asked");
  await putSettings(page, { model: null });
});

test("a local model can be configured, edited and removed", async ({ page, server }) => {
  await page.goto(await server.loginUrl());
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-nav-model").click();
  await page.getByTestId("local-models-open").click();
  await expect(page.getByTestId("local-models")).toBeVisible();
  await page.getByTestId("local-add").click();
  await page.getByTestId("local-model-id").fill("llama3.1:8b");
  await page.getByTestId("local-model-name").fill("Local Llama");
  await page.getByTestId("local-api").selectOption("anthropic-messages");
  await page.getByTestId("local-save").click();

  const id = "local-ollama-llama3-1-8b";
  const row = page.getByTestId(`local-row-${id}`);
  await expect(row).toContainText("Ollama");
  await expect(row).toContainText("Local Llama");
  await expect(row).toContainText("llama3.1:8b");

  // Edit the display name; the provider id and model stay the same.
  await page.getByTestId(`local-edit-${id}`).click();
  await page.getByTestId("local-model-name").fill("Local Llama 2");
  await page.getByTestId("local-save").click();
  await expect(page.getByTestId(`local-row-${id}`)).toContainText("Local Llama 2");

  // The new provider appears in the normal provider list and exposes its model.
  await page.getByTestId("local-back").click();
  const card = page.getByTestId(`model-provider-${id}`);
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByTestId("model-id")).toHaveValue("llama3.1:8b");
  await expect(page.getByTestId("model-local-manage")).toBeVisible();
  await page.getByTestId("model-back").click();

  // Remove the configuration again; the provider card goes away too.
  await page.getByTestId("local-models-open").click();
  await page.getByTestId(`local-delete-${id}`).click();
  await page.getByTestId(`local-delete-confirm-${id}`).click();
  await expect(page.getByTestId("local-empty")).toBeVisible();
  await page.getByTestId("local-back").click();
  await expect(page.getByTestId(`model-provider-${id}`)).toHaveCount(0);
});
