import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { tinyPng } from "../packages/server/test/fixtures/images.ts";
import { bukitForTests } from "./fake-bukit.ts";
import { expect, test } from "./fixtures.ts";
import { putSettings } from "./site-helpers.ts";

// Theme development T1 layer 4 (design 2, 4): the mode switch, the new-theme dialog and the theme mode's panels.
// Builds use a stand-in Bukit unless BUKIT_BIN names a real one.

test.describe.configure({ timeout: 120_000 });

let work: string;
let bukitBin: string;

test.beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-e2e-themes-")));
  bukitBin = process.env.BUKIT_BIN ?? bukitForTests(work);
});

test.afterAll(async ({ browser, server }) => {
  const page = await browser.newPage();
  await page.goto(await server.loginUrl());
  await putSettings(page, { commitName: null, commitEmail: null });
  await page.close();
  fs.rmSync(work, { recursive: true, force: true });
});

async function login(page: Page, server: { loginUrl(): Promise<string>; setBukit(source: string): void }) {
  await page.goto(await server.loginUrl());
  server.setBukit(bukitBin);
  await page.evaluate(() => fetch("/api/bukit?refresh=1"));
  await putSettings(page, { commitName: "E2E Tester", commitEmail: "e2e@example.com" });
  await page.reload();
  await expect(page.getByTestId("site-list")).toBeVisible();
}

test("a theme is made from a description and image, and the theme mode shows its panels", async ({ page, server }) => {
  await login(page, server);
  await page.getByTestId("mode-theme").click();
  await expect(page).toHaveURL(/\/themes$/);
  await expect(page.getByTestId("theme-welcome")).toBeVisible();

  const parent = fs.mkdtempSync(path.join(work, "p-"));
  const brief = "A calm blog theme with a beige background and serif headings.";
  await page.getByTestId("new-theme").click();
  await page.locator("#theme-project-name").fill("Paper Notes");
  await expect(page.getByTestId("new-theme-dir")).toHaveValue("paper-notes");
  await page.getByTestId("new-theme-brief").fill(brief);
  await page
    .getByTestId("new-theme-images-input")
    .setInputFiles({ name: "mood.png", mimeType: "image/png", buffer: tinyPng() });
  await expect(page.getByTestId("new-theme-image")).toHaveCount(1);
  const folder = page.getByRole("dialog").getByTestId("dir-current");
  await expect(folder).not.toHaveValue("");
  await folder.fill(parent);
  await folder.press("Enter");
  await expect(folder).toHaveValue(parent);
  await page.getByTestId("new-theme-create").click();

  // The first conversation opens with the description waiting in its input, not sent.
  await expect(page).toHaveURL(/\/themes\/[0-9a-f]+\/sessions\/[0-9a-f]+$/);
  const themeUrl = page.url();
  await expect(page.getByTestId("composer-input")).toHaveValue(new RegExp(`^${brief}`));
  await expect(page.getByTestId("theme-list")).toContainText("Paper Notes");
  const dir = path.join(parent, "paper-notes");
  expect(fs.existsSync(path.join(dir, "themes", "paper-notes", "theme.yaml"))).toBe(true);
  expect(fs.readdirSync(path.join(dir, "_reference"))).toHaveLength(1);

  // Theme mode's tabs: no config, data or SEO; sample content and reference images instead.
  for (const tab of ["config", "data", "seo"]) await expect(page.getByTestId(`tab-${tab}`)).toHaveCount(0);
  await page.getByTestId("tab-theme").click();
  await expect(page.getByTestId("theme-name")).toHaveText("paper-notes");
  await expect(page.getByTestId("coverage-home")).toHaveAttribute("data-ok", "true");
  await page.getByTestId("tab-samples").click();
  await expect(page.getByTestId("samples-panel").getByTestId("sample-item")).toHaveCount(15);
  await page.getByTestId("tab-reference").click();
  await expect(page.getByTestId("reference-panel").getByTestId("reference-image")).toHaveCount(1);

  // The preview picks a sample page and a width.
  await page.getByTestId("tab-preview").click();
  const frame = page.getByTestId("preview-frame");
  await expect(frame).toBeVisible();
  await page.getByTestId("preview-page-type").selectOption("post");
  await expect(frame).toHaveAttribute("src", /\/blog\/2026\/01\/welcome\/$/);
  await page.getByTestId("preview-width-phone").click();
  await expect(page.getByTestId("preview-width-phone")).toHaveAttribute("aria-pressed", "true");
  await expect(frame).toHaveAttribute("style", /width: 375px/);

  // Each mode keeps its last place.
  await page.getByTestId("mode-site").click();
  await expect(page).not.toHaveURL(/\/themes/);
  await expect(page.getByTestId("site-list")).toBeVisible();
  await page.getByTestId("mode-theme").click();
  await expect(page).toHaveURL(new RegExp(`^${themeUrl.replace(/[.?]/g, "\\$&")}`));
});
