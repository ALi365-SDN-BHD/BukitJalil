import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { bukitForTests } from "./fake-bukit.ts";
import { expect, test } from "./fixtures.ts";
import { importSite, putSettings, removeImportedSites, siteFolder } from "./site-helpers.ts";

// M3 acceptance (plan M3) with the scripted model (packages/server/src/agent/fake-model.ts), which picks its
// steps from a tag in the request (#faq, #auth, #plugin): the AI changes only its working copy and passes
// the check, reading Pi's auth.json is refused, a plugin that is not built in stops the AI's build.
// Reloading restores the conversation (also covered in models.spec.ts). Bukit is the stand-in unless
// BUKIT_BIN names a real one.

let work: string;
let bukitBin: string;

test.beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-e2e-agent-")));
  bukitBin = bukitForTests(work);
});

// The server is shared with later spec files: put the settings back.
test.afterAll(async ({ browser, server }) => {
  const page = await browser.newPage();
  await page.goto(await server.loginUrl());
  await putSettings(page, { model: null, bukitPath: null });
  await page.close();
  removeImportedSites();
  fs.rmSync(work, { recursive: true, force: true });
});

/** Log in, choose the scripted model and the test Bukit, open a new conversation on a fresh site. */
async function startConversation(page: Page, loginUrl: string, label: string): Promise<string> {
  await page.goto(loginUrl);
  await putSettings(page, { model: { provider: "bukitjalil-fake", id: "fake-1" }, bukitPath: bukitBin });
  const siteId = await importSite(page, label);
  await page.goto(`/sites/${siteId}`);
  await page.getByTestId("start-conversation").click();
  await expect(page.getByTestId("chat-view")).toBeVisible();
  return siteId;
}

/** Send a request and wait until the scripted model's answer has arrived and the run is over. */
async function ask(page: Page, text: string) {
  const input = page.getByTestId("composer-input");
  await input.fill(text);
  await input.press("Enter");
  await expect(page.getByTestId("message-assistant").last()).toContainText("You asked", { timeout: 30_000 });
  await expect(page.getByTestId("chat-status")).toHaveCount(0);
  await expect(page.getByTestId("chat-error")).toHaveCount(0);
}

const card = (page: Page, tool: string) => page.locator(`[data-testid=tool-card][data-tool=${tool}]`);

/** Opens a tool card and returns its result text. */
async function cardResult(page: Page, tool: string): Promise<string> {
  const c = card(page, tool);
  await c.locator("summary").click();
  return (await c.locator("pre").last().textContent()) ?? "";
}

test.describe.configure({ timeout: 90_000 });

test("the AI changes only its working copy, passes the check and sums up", async ({ page, server }) => {
  const siteId = await startConversation(page, await server.loginUrl(), "Agent edit");
  const folder = siteFolder(siteId);
  const siteYaml = fs.readFileSync(path.join(folder, "site.yaml"), "utf8");

  await ask(page, '#faq Change the home page title to "Welcome X" and add an FAQ page');
  for (const tool of ["read", "edit", "write", "bukit_check", "summarize_changes"]) {
    await expect(card(page, tool)).toHaveAttribute("data-state", "ok");
  }
  await expect(page.getByTestId("tool-diff").first()).toBeAttached();
  expect(JSON.parse(await cardResult(page, "bukit_check")).passed).toBe(true);
  await expect(page.getByTestId("chat-summary")).toContainText('Changed the site title to "Welcome X"');
  await expect(page.getByTestId("message-assistant").last()).toContainText("All 5 steps went through");

  // The site's own folder (the default branch) is untouched: the change waits for review (M4).
  expect(fs.readFileSync(path.join(folder, "site.yaml"), "utf8")).toBe(siteYaml);
  expect(fs.existsSync(path.join(folder, "content/pages/faq.md"))).toBe(false);

  // After a reload the conversation, its tool cards and the summary come back.
  await page.reload();
  await expect(card(page, "summarize_changes")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("chat-summary")).toContainText("Welcome X");
});

test("reading Pi's auth.json outside the working copy is refused", async ({ page, server }) => {
  await startConversation(page, await server.loginUrl(), "Agent read");
  await ask(page, "#auth Show me what is in auth.json");
  await expect(card(page, "read")).toHaveAttribute("data-state", "error");
  // The refused path is the app's own pi/auth.json, not some other outside path.
  const refused = await cardResult(page, "read");
  expect(refused).toMatch(/Path not allowed: \S+[\\/]pi[\\/]auth\.json is outside the site's working copy/);
  await expect(page.getByTestId("message-assistant").last()).toContainText("1 of my 1 steps were refused");
});

test("a plugin that is not built in stops the AI's build", async ({ page, server }) => {
  await startConversation(page, await server.loginUrl(), "Agent plugin");
  await ask(page, "#plugin Add a plugin to the site and build it");
  // The plugin goes in, the build is refused, the plugin comes out again.
  await expect(card(page, "edit")).toHaveCount(2);
  for (const edit of await card(page, "edit").all()) await expect(edit).toHaveAttribute("data-state", "ok");
  await expect(card(page, "bukit_build")).toHaveAttribute("data-state", "error");
  const result = await cardResult(page, "bukit_build");
  expect(result).toContain("pre-build safety check refused");
  expect(result).toContain("site.plugins.fake-plugin");
  await expect(page.getByTestId("message-assistant").last()).toContainText("1 of my 3 steps were refused");
});

test("a provider's error is explained in plain words, with its own text kept", async ({ page, server }) => {
  // Pi retries rate limits and network failures a few times with a growing wait before giving up.
  test.setTimeout(240_000);
  await startConversation(page, await server.loginUrl(), "Agent errors");
  const input = page.getByTestId("composer-input");
  for (const [tag, kind, text] of [
    ["#fail-key", "auth", /API key|API Key/],
    ["#fail-limit", "limit", /rate limit|频率限制/],
    ["#fail-network", "network", /network|网络/],
  ] as const) {
    await input.fill(`${tag} Try it`);
    await input.press("Enter");
    const error = page.getByTestId("model-error").last();
    await expect(error).toHaveAttribute("data-kind", kind, { timeout: 60_000 });
    await expect(error).toContainText(text);
    await expect(page.getByTestId("chat-status")).toHaveCount(0, { timeout: 60_000 });
  }
  const last = page.getByTestId("model-error").last();
  await last.locator("summary").click();
  await expect(last).toContainText("ENOTFOUND");
});
