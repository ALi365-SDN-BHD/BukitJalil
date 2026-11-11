import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { BUKIT_VERSION } from "../packages/server/src/bukit/install.ts";
import { copyStarter } from "../packages/server/src/sites/template.ts";
import { bukitForTests } from "./fake-bukit.ts";
import { expect, test } from "./fixtures.ts";
import { putSettings } from "./site-helpers.ts";

// M2 end to end (plan 12): new site, import, read-only import, builds and the preview, the read-only panels,
// archive and remove, settings. Builds use a stand-in Bukit unless BUKIT_BIN names a real one.

const REAL_BUKIT = process.env.BUKIT_BIN;
const STARTER = path.resolve(import.meta.dirname, "../templates/starter");

// Creating a site runs its first build, and the first test also walks all the panels: give builds on a slow
// runner (or a real Bukit) room beyond the default 30 s.
test.describe.configure({ timeout: 120_000 });

let work: string;
let bukitBin: string;
let counter = 0;

test.beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-e2e-sites-")));
  bukitBin = bukitForTests(work);
});

// The server outlives this file (one per worker): clear what login() set, so a later spec does not find a
// Bukit path pointing at the deleted stand-in.
test.afterAll(async ({ browser, server }) => {
  const page = await browser.newPage();
  await page.goto(await server.loginUrl());
  await putSettings(page, { bukitPath: null, commitName: null, commitEmail: null });
  await page.close();
  fs.rmSync(work, { recursive: true, force: true });
});

/** A name and an empty parent folder unique to this test (the server is shared by a project's tests). */
function fresh(label: string) {
  counter++;
  const name = `E2E ${label} ${counter}${Math.random().toString(36).slice(2, 6)}`;
  const parent = fs.mkdtempSync(path.join(work, "p-"));
  return { name, parent };
}

function git(cwd: string, ...args: string[]) {
  execFileSync("git", ["-c", "user.name=E2E", "-c", "user.email=e2e@example.com", ...args], {
    cwd,
    stdio: "pipe",
    env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1" },
  });
}

/** Log in, then point the server at the test Bukit and give it a commit identity. */
async function login(page: Page, url: string) {
  await page.goto(url);
  await putSettings(page, { bukitPath: bukitBin, commitName: "E2E Tester", commitEmail: "e2e@example.com" });
  await page.reload();
  await expect(page.getByTestId("site-list")).toBeVisible();
}

async function goToFolder(page: Page, dir: string) {
  const input = page.getByRole("dialog").getByTestId("dir-current");
  await expect(input).not.toHaveValue("");
  await input.fill(dir);
  await input.press("Enter");
  await expect(input).toHaveValue(dir);
}

async function createSite(page: Page, name: string, parent: string) {
  await page.getByTestId("new-site").click();
  await page.locator("#site-name").fill(name);
  await goToFolder(page, parent);
  await page.getByTestId("new-site-create").click();
  await expect(page).toHaveURL(/\/sites\/[0-9a-f]+$/);
  await expect(page.getByTestId("site-home")).toBeVisible();
}

const headerBuild = (page: Page) => page.locator("header").getByTestId("build-status");

async function sitePath(page: Page): Promise<string> {
  return (await page.getByTestId("site-path").textContent())?.trim() ?? "";
}

test("a new site builds once, shows its preview and the read-only panels", async ({ page, server }) => {
  await login(page, await server.loginUrl());
  const { name, parent } = fresh("New");
  await createSite(page, name, parent);
  await expect(page.getByTestId("header-site-title")).toHaveText(name);
  await expect(headerBuild(page)).toHaveText(/Succeeded|成功/, { timeout: 60_000 });
  await expect(page.getByTestId("site-list").getByRole("link", { name })).toBeVisible();

  // Preview: the newest build in a sandboxed iframe on its own port.
  const frame = page.getByTestId("preview-frame");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).toHaveAttribute("src", /^http:\/\/127\.0\.0\.1:\d+\/$/);
  await expect(page.frameLocator("[data-testid=preview-frame]").getByText(name).first()).toBeVisible();

  // Files: site.yaml highlighted, a post rendered as Markdown.
  await page.getByTestId("tab-files").click();
  const tree = page.getByTestId("file-tree");
  await tree.getByRole("button", { name: "site.yaml" }).click();
  await expect(page.getByTestId("file-path")).toHaveText("site.yaml");
  await expect(page.getByTestId("code-view")).toContainText(`title: ${name}`);
  await tree.getByRole("button", { name: "content" }).click();
  await tree.getByRole("button", { name: "posts" }).click();
  await tree.getByRole("button", { name: "welcome.md" }).click();
  await expect(page.getByTestId("markdown-view").locator("h1, h2").first()).toBeVisible();
  await expect(page).toHaveURL(/panel=files&file=content%2Fposts%2Fwelcome\.md/);

  await page.getByTestId("tab-config").click();
  await expect(page.getByTestId("config-panel")).toContainText(name);
  await page.getByTestId("tab-theme").click();
  await expect(page.getByTestId("theme-name")).toHaveText("starter");
  await page.getByTestId("tab-data").click();
  await expect(page.getByTestId("data-source").first()).toBeVisible();

  // The open tab survives a reload.
  await page.reload();
  await expect(page.getByTestId("tab-data")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("tab-changes").click();
  await expect(page.getByTestId("changes-empty")).toBeVisible();
});

test("a build report shows the SEO / GEO summary", async ({ page, server }) => {
  await login(page, await server.loginUrl());
  const { name, parent } = fresh("Seo");
  await createSite(page, name, parent);
  await expect(headerBuild(page)).toHaveText(/Succeeded|成功/, { timeout: 60_000 });
  await page.getByTestId("build-list").getByRole("button").first().click();
  const audit = page.getByTestId("build-audit");
  await expect(audit.getByTestId("audit-seo")).toBeVisible();
  // A new site has no site.url: those warnings are one hint, not a list.
  await expect(audit.getByTestId("audit-site-url")).toContainText("site.url");
  await expect(audit.getByTestId("audit-group").filter({ hasText: "seo.canonical_not_absolute" })).toHaveCount(0);
  await expect(audit.getByTestId("audit-geo-score")).toContainText(/\d+\/100/);
  await page.keyboard.press("Escape");
});

test("a failed build shows its outcome and report", async ({ page, server }) => {
  test.skip(!!REAL_BUKIT, "the failure comes from the stand-in Bukit");
  await login(page, await server.loginUrl());
  const { name, parent } = fresh("Fail");
  await createSite(page, name, parent);
  await expect(headerBuild(page)).toHaveText(/Succeeded|成功/, { timeout: 60_000 });

  const dir = await sitePath(page);
  fs.writeFileSync(path.join(dir, "fake-mode"), "fail");
  git(dir, "add", "fake-mode");
  git(dir, "commit", "-q", "-m", "break the build");

  await page.getByTestId("build-button").first().click();
  await expect(headerBuild(page)).toHaveText(/Config or content error|配置或内容错误/, { timeout: 30_000 });
  await page.getByTestId("build-list").getByRole("button").first().click();
  const report = page.getByTestId("build-report");
  await expect(report).toContainText("event=content.error file=broken.md");
  await expect(report).toContainText("boom");
});

test("a folder that is not a git repository yet is imported after confirming its files", async ({ page, server }) => {
  await login(page, await server.loginUrl());
  const { name, parent } = fresh("Import");
  const dir = path.join(parent, "existing");
  copyStarter(STARTER, dir, { title: "Imported Original", language: "en-US" });

  await page.getByTestId("import-site").click();
  await goToFolder(page, dir);
  await page.getByTestId("import-inspect").click();
  await expect(page.getByTestId("inspect-result")).toContainText("site.yaml");
  await expect(page.getByTestId("import-submit")).toBeDisabled();
  await page.getByTestId("import-confirm-files").check();
  await page.locator("#import-name").fill(name);
  await page.getByTestId("import-submit").click();

  await expect(page).toHaveURL(/\/sites\/[0-9a-f]+$/);
  await expect(page.getByTestId("header-site-title")).toHaveText(name);
  await expect(page.getByTestId("site-state")).toContainText(/Usable|可用/);
  await expect(headerBuild(page)).toHaveText(/Succeeded|成功/, { timeout: 60_000 });
  expect(fs.existsSync(path.join(dir, ".git"))).toBe(true);
});

test("a site with a plugin folder is imported read-only and cannot build", async ({ page, server }) => {
  await login(page, await server.loginUrl());
  const { name, parent } = fresh("ReadOnly");
  const dir = path.join(parent, "plugged");
  copyStarter(STARTER, dir, { title: "Plugged", language: "en-US" });
  fs.mkdirSync(path.join(dir, "plugins/x"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugins/x/plugin.yaml"), "name: x\n");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");

  await page.getByTestId("import-site").click();
  await goToFolder(page, dir);
  await page.getByTestId("import-inspect").click();
  const result = page.getByTestId("inspect-result");
  await expect(result).toContainText(/A git repository on branch main|当前分支 main/);
  await expect(result.getByTestId("reasons")).toBeVisible();
  await page.locator("#import-name").fill(name);
  await page.getByTestId("import-submit").click();

  await expect(page).toHaveURL(/\/sites\/[0-9a-f]+$/);
  await expect(page.getByTestId("site-state")).toContainText(/Read-only|只读/);
  await expect(page.getByTestId("site-home").getByTestId("reasons")).toContainText("plugins/");
  await expect(page.getByTestId("site-home").getByTestId("build-button")).toBeDisabled();
  await expect(
    page
      .getByTestId("site-list")
      .getByRole("link", { name })
      .getByLabel(/Read-only|只读/),
  ).toBeVisible();
  // The read-only panels still work.
  await page.getByTestId("tab-files").click();
  await expect(page.getByTestId("file-tree").getByRole("button", { name: "plugins" })).toBeVisible();

  // Once the plugin folder is gone from the default branch, checking again makes the site usable.
  git(dir, "rm", "-q", "-r", "plugins");
  git(dir, "commit", "-q", "-m", "drop the plugin");
  await page.getByTestId("site-recheck").click();
  await expect(page.getByTestId("site-state")).toContainText(/Usable|可用/);
  await expect(page.getByTestId("site-home").getByTestId("reasons")).toHaveCount(0);
  await expect(page.getByTestId("site-home").getByTestId("build-button")).toBeEnabled();
});

test("a site can be archived, restored and removed", async ({ page, server }) => {
  await login(page, await server.loginUrl());
  const { name, parent } = fresh("Archive");
  await createSite(page, name, parent);
  await expect(headerBuild(page)).toHaveText(/Succeeded|成功/, { timeout: 60_000 });
  const dir = await sitePath(page);
  const list = page.getByTestId("site-list");

  await page.getByTestId("site-archive").click();
  const archivedToggle = list.getByRole("button", { name: /Archived|已归档/ });
  await expect(archivedToggle).toBeVisible();
  await archivedToggle.click();
  await expect(list.getByRole("link", { name })).toBeVisible();
  await page.getByTestId("site-archive").click();
  await expect(page.getByTestId("site-archive")).toHaveText(/^\s*(Archive|归档)$/);
  await expect(archivedToggle).toHaveCount(0);
  await expect(list.getByRole("link", { name })).toBeVisible();

  await page.getByTestId("site-remove").click();
  await page.getByTestId("site-remove-confirm").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(list.getByRole("link", { name })).toHaveCount(0);
  // Removing unregisters the site; its folder and history stay.
  expect(fs.existsSync(path.join(dir, "site.yaml"))).toBe(true);
});

test("settings show Bukit and the identity; dialogs start empty each time", async ({ page, server }) => {
  await login(page, await server.loginUrl());
  await page.getByTestId("open-settings").click();
  // The stand-in prints 2.0.11, a real Bukit the pinned version.
  await expect(page.getByTestId("bukit-state")).toContainText(REAL_BUKIT ? BUKIT_VERSION : "2.0.11");
  await expect(page.locator("#commit-name")).toHaveValue("E2E Tester");
  await expect(page.locator("#bukit-path")).toHaveValue(bukitBin);
  // A fresh app home has no rg yet: the dialog offers the pinned version and asks before downloading.
  await expect(page.getByTestId("rg-state")).toContainText("ripgrep");
  await page.getByTestId("rg-install").click();
  await expect(page.getByTestId("rg-install-confirm")).toContainText("15.2.0");
  await page.keyboard.press("Escape");

  await page.getByTestId("new-site").click();
  await page.locator("#site-name").fill("Left behind");
  await page.keyboard.press("Escape");
  await page.getByTestId("new-site").click();
  await expect(page.locator("#site-name")).toHaveValue("");
});

test("the GitHub token is saved, shown by its last four characters and removed", async ({ page, server }) => {
  await login(page, await server.loginUrl());
  await page.getByTestId("open-settings").click();
  const status = page.getByTestId("github-token-status");
  await expect(status).toContainText(/GitHub token/i);
  await page.getByTestId("github-token-input").fill("ghp_e2eexampletoken9876");
  await page.getByTestId("github-token-input").press("Enter");
  await expect(status).toContainText("9876");
  await expect(page.getByTestId("github-token-input")).toHaveCount(0);
  await expect(page.getByTestId("github-token-section")).not.toContainText("ghp_e2e");
  await page.getByTestId("github-token-remove").click();
  await expect(page.getByTestId("github-token-input")).toBeVisible();
});
