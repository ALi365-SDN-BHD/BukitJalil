import { expect, test } from "@playwright/test";
import { ADMIN } from "./ports.ts";

const loginUrl = () => {
  const url = process.env.BJ_E2E_URL;
  if (!url) throw new Error("BJ_E2E_URL not set by global setup");
  return url;
};

test("token link logs in, drops the token from the URL and shows git status", async ({ page }) => {
  await page.goto(loginUrl());
  await expect(page).toHaveURL(`${ADMIN}/`);
  await expect(page.getByTestId("health")).toContainText("git");
});

test("admin pages carry the CSP and anti-framing headers", async ({ page }) => {
  const res = await page.goto(loginUrl());
  const headers = res?.headers() ?? {};
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("switches between Chinese and English and remembers the choice", async ({ page }) => {
  await page.goto(loginUrl());
  const select = page.getByTestId("locale-select");
  await select.selectOption("en");
  await expect(page.getByText("Sites", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.getByText("Sites", { exact: true })).toBeVisible();
  await select.selectOption("zh-CN");
  await expect(page.getByText("网站", { exact: true })).toBeVisible();
});

test("without the session cookie the API refuses and the UI says so", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ADMIN}/`);
  await expect(page.getByTestId("health")).toContainText(/登录已失效|session has expired/);
  await context.close();
});
