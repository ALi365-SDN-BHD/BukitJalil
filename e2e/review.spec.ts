import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { bukitForTests } from "./fake-bukit.ts";
import { expect, test } from "./fixtures.ts";
import { importSite, putSettings, removeImportedSites, siteFolder, startConversationButton } from "./site-helpers.ts";

// M4 acceptance (plan M4): conversation → review → change preview → apply → the main preview follows;
// rejecting leaves the site folder alone; ignored local files survive an apply; restoring an old version
// brings its content back; the default branch's history reads clearly. The scripted model's #faq request
// changes the title and adds an FAQ page; the stand-in Bukit's page shows the site title.

let work: string;
let bukitBin: string;

test.beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-e2e-review-")));
  bukitBin = bukitForTests(work);
});

// The server is shared with later spec files: put the settings back.
test.afterAll(async ({ browser, server }) => {
  const page = await browser.newPage();
  await page.goto(await server.loginUrl());
  await putSettings(page, { model: null, bukitPath: null, commitName: null, commitEmail: null });
  await page.close();
  removeImportedSites();
  fs.rmSync(work, { recursive: true, force: true });
});

test.describe.configure({ timeout: 120_000 });

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();

/** Log in with the scripted model, the test Bukit and an identity; open a conversation on a fresh site. */
async function startConversation(page: Page, loginUrl: string, label: string, language?: string) {
  await page.goto(loginUrl);
  await putSettings(page, {
    model: { provider: "bukitjalil-fake", id: "fake-1" },
    bukitPath: bukitBin,
    commitName: "Test Owner",
    commitEmail: "owner@example.com",
  });
  const siteId = await importSite(page, label, language);
  const folder = siteFolder(siteId);
  await page.goto(`/sites/${siteId}`);
  // The import builds the main version once; wait for it, so the preview shows it.
  await expect(page.locator("header").getByTestId("build-status")).toHaveText(/Succeeded|成功/, { timeout: 60_000 });
  await startConversationButton(page);
  await expect(page.getByTestId("chat-view")).toBeVisible();
  const title = /^ {2}title: *(.+)$/m.exec(fs.readFileSync(path.join(folder, "site.yaml"), "utf8"))?.[1] ?? "";
  return { siteId, folder, title };
}

/** Send a request and wait until the scripted model has answered and the change set can be reviewed. */
async function ask(page: Page, text: string) {
  const input = page.getByTestId("composer-input");
  await input.fill(text);
  await input.press("Enter");
  await expect(page.getByTestId("message-assistant").last()).toContainText("You asked", { timeout: 30_000 });
  await expect(page.getByTestId("chat-status")).toHaveCount(0);
  await expect(page.getByTestId("change-apply")).toBeEnabled();
}

const preview = (page: Page) => page.frameLocator("[data-testid=preview-frame]");

test("a reviewed change is previewed, applied, and the main preview follows", async ({ page, server }) => {
  const { folder, title } = await startConversation(page, await server.loginUrl(), "Review apply");
  // A local file the site ignores (the starter's .gitignore has dist/): applying must keep it.
  fs.mkdirSync(path.join(folder, "dist"), { recursive: true });
  fs.writeFileSync(path.join(folder, "dist/local.txt"), "mine\n");
  const head = git(folder, "rev-parse", "HEAD");

  await ask(page, '#faq Change the title to "Reviewed X" and add an FAQ page');
  const card = page.getByTestId("review-card");
  await expect(page.getByTestId("review-summary")).toContainText('Changed the site title to "Reviewed X"');
  await expect(card.getByTestId("changed-files")).toContainText("content/pages/faq.md");
  await expect(card.getByTestId("changed-files")).toContainText("site.yaml");

  // The diff of one file in the Changes panel.
  await card.getByRole("button", { name: /faq\.md/ }).click();
  await expect(page.getByTestId("changes-panel")).toBeVisible();
  await expect(page.getByTestId("diff-path")).toHaveText("content/pages/faq.md");
  await expect(page.getByTestId("diff-patch")).toContainText("+title: FAQ");

  // The change set's own preview, next to the main one.
  await page.getByTestId("tab-preview").click();
  await expect(preview(page).getByText(title).first()).toBeVisible();
  await page.getByTestId("ref-change").click();
  await page.getByRole("button", { name: /Build the changes|构建改动/ }).click();
  await expect(preview(page).getByText("Reviewed X").first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("ref-main").click();
  await expect(preview(page).getByText(title).first()).toBeVisible();
  // Nothing reached the site folder yet.
  expect(git(folder, "rev-parse", "HEAD")).toBe(head);

  await page.getByTestId("change-apply").click();
  await expect(page.getByTestId("change-notice")).toContainText(/Applied|已应用/);
  await expect(card).toHaveCount(0);
  expect(fs.existsSync(path.join(folder, "content/pages/faq.md"))).toBe(true);
  expect(fs.readFileSync(path.join(folder, "dist/local.txt"), "utf8")).toBe("mine\n");
  expect(git(folder, "status", "--porcelain")).toBe("");
  // One readable commit on the default branch: the AI's summary, the AI as author, the user as committer.
  expect(git(folder, "rev-parse", "HEAD^")).toBe(head);
  expect(git(folder, "log", "-1", "--format=%an|%cn|%s")).toBe(
    'BukitJalil AI|Test Owner|Changed the site title to "Reviewed X" and added an FAQ page.',
  );
  // Applying rebuilds the main version, and its preview follows.
  await expect(preview(page).getByText("Reviewed X").first()).toBeVisible({ timeout: 60_000 });
});

test("rejecting drops the AI's changes and leaves the site folder as it was", async ({ page, server }) => {
  const { folder } = await startConversation(page, await server.loginUrl(), "Review reject");
  const head = git(folder, "rev-parse", "HEAD");
  const siteYaml = fs.readFileSync(path.join(folder, "site.yaml"), "utf8");

  await ask(page, '#faq Change the title to "Rejected X" and add an FAQ page');
  await page.getByTestId("change-reject").click();
  await page
    .getByTestId("reject-confirm")
    .getByRole("button", { name: /Yes, reject|确认拒绝/ })
    .click();
  await expect(page.getByTestId("change-notice")).toContainText(/rejected|拒绝/);
  await expect(page.getByTestId("review-card")).toHaveCount(0);

  expect(git(folder, "rev-parse", "HEAD")).toBe(head);
  expect(git(folder, "status", "--porcelain")).toBe("");
  expect(fs.readFileSync(path.join(folder, "site.yaml"), "utf8")).toBe(siteYaml);
  expect(fs.existsSync(path.join(folder, "content/pages/faq.md"))).toBe(false);
});

test("restoring an old version on a Chinese site brings its content back", async ({ page, server }) => {
  const { siteId, folder, title } = await startConversation(page, await server.loginUrl(), "恢复 站点", "zh-CN");
  const first = git(folder, "rev-parse", "HEAD");
  await ask(page, '#faq Change the title to "新标题 X" and add an FAQ page');
  await page.getByTestId("change-apply").click();
  await expect(page.getByTestId("change-notice")).toContainText(/Applied|已应用/);
  await expect(preview(page).getByText("新标题 X").first()).toBeVisible({ timeout: 60_000 });

  // The history on the site home: the AI's version on top, marked as current.
  await page.goto(`/sites/${siteId}`);
  const entries = page.getByTestId("history-entry");
  await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText("新标题 X");
  await expect(entries.first().getByTestId("history-ai")).toBeVisible();
  await expect(entries.last().getByTestId("history-ai")).toHaveCount(0);
  await entries.last().click();
  const dialog = page.getByTestId("version-dialog");
  await expect(dialog.getByTestId("changed-files")).toContainText("site.yaml");
  await expect(dialog.getByTestId("diff-patch")).toBeVisible();
  await dialog.getByTestId("version-restore").click();

  // The restore waits for review like any change set.
  await expect(page.getByTestId("changes-panel")).toBeVisible();
  await expect(page.getByTestId("restore-note").first()).toContainText(first.slice(0, 7));
  await expect(page.getByTestId("changed-files").first()).toContainText("content/pages/faq.md");
  await page.getByTestId("changes-panel").getByTestId("change-apply").click();
  await expect(page.getByTestId("change-notice")).toContainText(/Applied|已应用/);

  expect(git(folder, "rev-parse", "HEAD^{tree}")).toBe(git(folder, "rev-parse", `${first}^{tree}`));
  expect(git(folder, "log", "-1", "--format=%an|%B")).toBe(
    `Test Owner|Restore to ${first.slice(0, 7)}: init\n\nBukitJalil-Restore: ${first}`,
  );
  await expect(entries).toHaveCount(3);
  await expect(entries.first()).toContainText(`Restore to ${first.slice(0, 7)}`);
  await page.getByTestId("tab-preview").click();
  await expect(preview(page).getByText(title).first()).toBeVisible({ timeout: 60_000 });
});
