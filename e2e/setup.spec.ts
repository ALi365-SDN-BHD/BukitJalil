import { expect, test } from "./fixtures.ts";
import { putSettings } from "./site-helpers.ts";

// M5 layer 1: the first-run guide on the home page follows the settings. Other spec files share the
// server and may have created sites or installed nothing, so only the steps this test controls are checked.

test.afterAll(async ({ browser, server }) => {
  const page = await browser.newPage();
  await page.goto(await server.loginUrl());
  await putSettings(page, { model: null, commitName: null, commitEmail: null });
  await page.close();
});

test("the setup guide shows what is missing and follows the settings", async ({ page, server }) => {
  await page.goto(await server.loginUrl());
  await putSettings(page, { model: null, commitName: null, commitEmail: null });
  await page.goto("/");
  const guide = page.getByTestId("setup-guide");
  await expect(guide).toBeVisible();
  await expect(page.getByTestId("setup-git")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("setup-identity")).toHaveAttribute("data-state", "todo");
  await expect(page.getByTestId("setup-model")).toHaveAttribute("data-state", "todo");

  // The settings button of the first open step opens the settings.
  await guide
    .getByRole("button", { name: /Open settings|打开设置/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await putSettings(page, {
    model: { provider: "bukitjalil-fake", id: "fake-1" },
    commitName: "Test Owner",
    commitEmail: "owner@example.com",
  });
  const loaded = ["/api/settings", "/api/models", "/api/bukit", "/api/sites"].map((p) =>
    page.waitForResponse((r) => new URL(r.url()).pathname === p),
  );
  await page.reload();
  await Promise.all(loaded);
  // Both steps are done; when nothing else is left (Bukit on PATH, sites from other files) the guide is gone.
  for (const step of ["setup-identity", "setup-model"])
    await expect(page.locator(`[data-testid=${step}]:not([data-state=done])`)).toHaveCount(0);
});
