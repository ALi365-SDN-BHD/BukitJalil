import { expect, test } from "./fixtures.ts";
import { importSite, putSettings, removeImportedSites } from "./site-helpers.ts";

// M5 layer 3: dark mode, keyboard shortcuts and the narrow-screen layout.

test.afterAll(async ({ browser, server }) => {
  const page = await browser.newPage();
  await page.goto(await server.loginUrl());
  await putSettings(page, { appearance: "system" });
  await page.close();
  removeImportedSites();
});

test("the appearance choice switches the theme and is kept", async ({ page, server }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(await server.loginUrl());
  const html = page.locator("html");
  await page.getByTestId("appearance-select").selectOption("dark");
  await expect(html).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);
  await expect(page.getByTestId("appearance-select")).toHaveValue("dark");

  await page.getByTestId("appearance-select").selectOption("light");
  await expect(html).not.toHaveClass(/\bdark\b/);

  // "System" follows the browser.
  await page.getByTestId("appearance-select").selectOption("system");
  await expect(html).not.toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveClass(/\bdark\b/);
});

test("Alt+number picks a panel and ? lists the shortcuts", async ({ page, server }) => {
  await page.goto(await server.loginUrl());
  const siteId = await importSite(page, "Keys");
  await page.goto(`/sites/${siteId}`);
  await expect(page.getByTestId("tab-preview")).toHaveAttribute("aria-selected", "true");
  await page.locator("body").click({ position: { x: 1, y: 1 } });

  await page.keyboard.press("Alt+Digit3");
  await expect(page.getByTestId("tab-files")).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/panel=files/);
  await page.keyboard.press("Alt+Digit2");
  await expect(page.getByTestId("tab-changes")).toHaveAttribute("aria-selected", "true");
  // Not inside a form field, where Option+digit types characters on some keyboard layouts.
  await page.getByTestId("locale-select").focus();
  await page.keyboard.press("Alt+Digit1");
  await expect(page.getByTestId("tab-changes")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("locale-select").blur();

  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
  await expect(page.getByTestId("shortcuts-dialog")).toContainText("Alt+1");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shortcuts-dialog")).toBeHidden();
});

test("a narrow screen shows one column at a time", async ({ page, server }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(await server.loginUrl());
  const siteId = await importSite(page, "Narrow");
  await page.goto(`/sites/${siteId}`);
  await expect(page.getByTestId("narrow-layout")).toBeVisible();
  await expect(page.getByTestId("column-conversation")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("tab-preview")).toBeHidden();

  await page.getByTestId("column-panels").click();
  await expect(page.getByTestId("tab-preview")).toBeVisible();
  await page.getByTestId("column-sites").click();
  await expect(page.getByTestId("tab-preview")).toBeHidden();

  // Opening a panel from a link shows the panels column.
  await page.goto(`/sites/${siteId}?panel=config`);
  await expect(page.getByTestId("column-panels")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("tab-config")).toHaveAttribute("aria-selected", "true");

  // Nothing is wider than the screen.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
