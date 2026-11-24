import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { tinyPng } from "../packages/server/test/fixtures/images.ts";
import { writeStarter } from "../packages/server/test/fixtures/starter.ts";
import { bukitForTests } from "./fake-bukit.ts";
import { expect, test } from "./fixtures.ts";
import { importSite, putSettings, removeImportedSites } from "./site-helpers.ts";

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
  removeImportedSites();
  fs.rmSync(work, { recursive: true, force: true });
});

async function login(page: Page, server: { loginUrl(): Promise<string>; setBukit(source: string): void }) {
  await page.goto(await server.loginUrl());
  server.setBukit(bukitBin);
  await page.evaluate(() => fetch("/api/bukit?refresh=1"));
  await putSettings(page, { commitName: "E2E Tester", commitEmail: "e2e@example.com", locale: "en" });
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
  await page.getByTestId("new-theme-description").click();
  await page.locator("#theme-project-name").fill("Paper Notes");
  await expect(page.getByTestId("new-theme-dir")).toHaveValue("paper-notes");
  await page.getByTestId("new-theme-brief").fill(brief);
  await page
    .getByTestId("new-theme-images-input")
    .setInputFiles({ name: "mood.png", mimeType: "image/png", buffer: tinyPng() });
  await expect(page.getByTestId("new-theme-image")).toHaveCount(1);
  // The neutral design system is chosen unless the user picks Material.
  await expect(page.getByTestId("design-system-default")).toBeChecked();
  await page.getByTestId("design-system-material").check();
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
  expect(fs.readFileSync(path.join(dir, "themes", "paper-notes", "tokens.yaml"), "utf8")).toContain(
    "BukitJalil's Material design system",
  );

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
  // The prefilled description is still waiting in the box after leaving the conversation and coming back.
  await expect(page.getByTestId("composer-input")).toHaveValue(new RegExp(`^${brief}`));
  // Panel tabs are named by their label; the shortcut is declared, not used as the name.
  await expect(page.getByTestId("tab-theme")).toHaveAttribute("aria-keyshortcuts", "Alt+4");
  await expect(page.getByTestId("tab-theme")).toHaveAccessibleName(/^(Theme|主题)$/);
});

test("a theme is applied to a site as its change set and exported as a zip", async ({ page, server }) => {
  await login(page, server);
  const siteId = await importSite(page, "Theme Target");
  const parent = fs.mkdtempSync(path.join(work, "apply-"));
  const theme = await page.evaluate(async (root) => {
    const res = await fetch("/api/themes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BukitJalil": "1" },
      body: JSON.stringify({ name: "Apply Me", themeName: "apply-me", path: `${root}/apply-me`, language: "en-US" }),
    });
    if (!res.ok) throw new Error(`theme: ${res.status}`);
    return (await res.json()) as { id: string };
  }, parent);

  // A design lint warning on the theme's default branch shows in the dialog and does not block applying.
  const project = path.join(parent, "apply-me");
  fs.writeFileSync(
    path.join(project, "themes", "apply-me", "assets", "extra.css"),
    ".nav { backdrop-filter: blur(4px); }\n",
  );
  execFileSync("git", ["-C", project, "add", "-A"]);
  execFileSync("git", ["-C", project, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "glass"]);

  await page.goto(`/themes/${theme.id}`);
  await expect(page.getByTestId("theme-home")).toBeVisible();
  await page.getByTestId("apply-theme").click();
  const dialog = page.getByTestId("apply-theme-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("apply-theme-site")).toHaveValue(siteId);
  await expect(dialog).toContainText("starter");
  const lint = dialog.getByTestId("apply-theme-lint");
  await expect(lint).toContainText(/(Design check warnings \(1\)|设计检查：1 条提醒)/);
  await lint.locator("summary").click();
  await expect(lint).toContainText(/(Frosted glass|毛玻璃效果)/);
  await expect(lint).toContainText("assets/extra.css:1");
  await dialog.getByTestId("apply-theme-confirm").click();
  await expect(dialog).toContainText("Review and apply it on the site");

  // The site's change set has the theme; nothing was written to its default branch.
  await dialog.getByRole("link", { name: "Review the changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}\\?panel=changes$`));
  await expect(page.getByTestId("changes-panel")).toContainText("themes/apply-me/theme.yaml");

  // The export is the theme directory only.
  await page.goto(`/themes/${theme.id}`);
  const download = page.waitForEvent("download");
  await page.getByTestId("export-theme").click();
  expect((await download).suggestedFilename()).toBe("apply-me.zip");
});

test("a theme folder is imported, and a site folder is handed to the site importer", async ({ page, server }) => {
  await login(page, server);
  const root = fs.mkdtempSync(path.join(work, "import-"));
  const source = path.join(root, "helios");
  fs.mkdirSync(path.join(source, "layouts"), { recursive: true });
  fs.writeFileSync(path.join(source, "theme.yaml"), "name: helios\ndisplay_name: Helios\n");
  fs.writeFileSync(path.join(source, "layouts", "index.html"), "<h1>Helios</h1>");

  await page.getByTestId("mode-theme").click();
  await page.getByTestId("new-theme").click();
  await page.getByTestId("import-theme").click();
  await page.getByTestId("theme-import-source").fill(source);
  await page.getByTestId("theme-import-inspect").click();
  await expect(page.getByTestId("theme-import-candidates")).toContainText("Helios");
  await page.getByTestId("import-theme-dialog").locator("#theme-project-name").fill("Helios Imported");
  const folder = page.getByRole("dialog").getByTestId("dir-current");
  await folder.fill(root);
  await folder.press("Enter");
  await expect(folder).toHaveValue(root);
  await page.getByTestId("theme-import-confirm").click();
  await expect(page.getByTestId("theme-home")).toContainText("Helios Imported");
  expect(fs.existsSync(path.join(root, "helios-imported", "themes", "helios", "theme.yaml"))).toBe(true);

  // A Bukit site folder offers the site importer; the path is carried over.
  const siteSource = path.join(root, "existing-site");
  writeStarter(siteSource, { title: "Existing Site", language: "en-US" });
  await page.getByTestId("new-theme").click();
  await page.getByTestId("import-theme").click();
  await page.getByTestId("theme-import-source").fill(siteSource);
  await page.getByTestId("theme-import-inspect").click();
  await expect(page.getByTestId("theme-import-as-site")).toBeVisible();
  await page.getByTestId("theme-import-as-site").click();
  await expect(page.getByTestId("mode-site")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("dialog").getByTestId("dir-current")).toHaveValue(siteSource);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
});
