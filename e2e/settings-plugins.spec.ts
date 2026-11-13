import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bukitForTests } from "./fake-bukit.ts";
import { expect, test } from "./fixtures.ts";
import { ADMIN } from "./ports.ts";
import { importSite, putSettings, removeImportedSites, siteFolder } from "./site-helpers.ts";

let work: string;
let bukitBin: string;

test.beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-e2e-settings-plugins-")));
  bukitBin = bukitForTests(work);
});

test.afterAll(async ({ browser, server }) => {
  // The server is shared with later spec files: put the identity back.
  const page = await browser.newPage();
  await page.goto(await server.loginUrl());
  await putSettings(page, { commitName: null, commitEmail: null });
  await page.close();
  removeImportedSites();
  fs.rmSync(work, { recursive: true, force: true });
});

test("settings lists skills and Bukit plugins, and a site can toggle a plugin through review", async ({
  page,
  server,
}) => {
  await page.goto(await server.loginUrl());
  // A previous spec may have replaced the stand-in; put this test's copy back before importing a site.
  server.setBukit(bukitBin);
  await page.evaluate(() => fetch("/api/bukit?refresh=1"));
  await putSettings(page, { commitName: "E2E", commitEmail: "e2e@example.com" });
  await page.getByTestId("open-settings").click();

  // Settings → Skills: every bundled skill is listed; the required one cannot be switched off.
  await page.getByTestId("settings-nav-skills").click();
  await expect(page.getByTestId("skill-site-editing")).toBeVisible();
  await expect(page.getByTestId("skill-content-writing")).toBeVisible();
  await expect(page.getByTestId("skill-toggle-site-editing")).toBeDisabled();
  const contentWriting = page.getByTestId("skill-toggle-content-writing");
  await expect(contentWriting).toHaveAttribute("aria-checked", "true");
  await contentWriting.click();
  await expect(contentWriting).toHaveAttribute("aria-checked", "false");
  await contentWriting.click();
  await expect(contentWriting).toHaveAttribute("aria-checked", "true");

  // Settings → Extensions: the Bukit built-in plugin catalog, without a site selector.
  await page.getByTestId("settings-nav-extensions").click();
  await expect(page.getByTestId("extension-related-content")).toBeVisible();
  await expect(page.getByTestId("extension-taxonomy")).toBeVisible();

  // Site → Config → Plugins: the switch creates a reviewed site.yaml change.
  const siteId = await importSite(page, "Plugin");
  await page.goto(`${ADMIN}/sites/${siteId}`);
  await page.getByTestId("tab-config").click();
  await page.getByTestId("config-tab-plugins").click();
  await expect(page.getByTestId("plugin-toggle-related-content")).toBeVisible();
  // Importing ran a check on the site; until it ends the switch answers 409 "site busy" (slow runners with a
  // real Bukit). Click again only after such an answer, so a slow success is never switched back.
  await expect(async () => {
    const answer = page.waitForResponse((r) => r.url().includes(`/api/sites/${siteId}/plugins/related-content`));
    await page.getByTestId("plugin-toggle-related-content").click({ timeout: 2_000 });
    expect((await answer).status()).toBe(200);
  }).toPass({ timeout: 60_000 });
  await expect(page.getByTestId("config-view-change")).toBeVisible();
  // With a change set open, choosing the main version must send the plugin tab back to "in change".
  await page.getByTestId("ref-main").click();
  await expect(page.getByTestId("ref-change")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("config-view-change").click();
  await expect(page.getByTestId("changes-panel")).toBeVisible();
  await expect(page.getByTestId("diff-patch")).toContainText("related-content");
  await page.getByTestId("change-apply").click();
  await expect(page.getByTestId("change-notice")).toContainText(/Applied to the main version|已应用到正式版本/);
  expect(fs.readFileSync(path.join(siteFolder(siteId), "site.yaml"), "utf8")).toContain("related-content: false");
});
