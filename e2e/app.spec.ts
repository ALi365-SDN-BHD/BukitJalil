import { expect, test } from "./fixtures.ts";
import { ADMIN } from "./ports.ts";

declare global {
  interface Window {
    __cspViolations: string[];
  }
}

test("token link logs in, drops the token from the URL and shows git status", async ({ page, server }) => {
  await page.goto(await server.loginUrl());
  await expect(page).toHaveURL(`${ADMIN}/`);
  await expect(page.getByTestId("app-version")).toContainText("BukitJalil");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-nav-environment").click();
  await expect(page.getByTestId("git-version")).toHaveText(/\d+\.\d+\.\d+|未安装|Not installed/);
});

test("a login link works only once", async ({ browser, server }) => {
  const url = await server.loginUrl();
  const first = await browser.newContext();
  const page = await first.newPage();
  await page.goto(url);
  await expect(page.getByTestId("app-version")).toContainText("BukitJalil");

  const second = await browser.newContext();
  const replay = await second.newPage();
  await replay.goto(url);
  await expect(replay).toHaveURL(`${ADMIN}/`);
  await expect(replay.getByTestId("health")).toContainText(/登录已失效|session has expired/);
  await first.close();
  await second.close();
});

test("admin pages carry the CSP and anti-framing headers", async ({ page, server }) => {
  const res = await page.goto(await server.loginUrl());
  const headers = res?.headers() ?? {};
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("the UI runs without CSP violations; runtime <style> needs the page nonce", async ({ page, server }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  await page.goto(await server.loginUrl());
  await expect(page.getByTestId("app-version")).toContainText("BukitJalil");
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);

  // What Radix does for dialogs: insert <style> with the nonce from <meta property="csp-nonce">.
  const result = await page.evaluate(async () => {
    const nonce = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.nonce ?? "";
    const add = (css: string, withNonce: boolean) => {
      const s = document.createElement("style");
      if (withNonce) s.nonce = nonce;
      s.textContent = css;
      document.head.append(s);
    };
    add("body { outline: 3px solid red; }", false);
    add("body { text-decoration: underline; }", true);
    await new Promise((r) => setTimeout(r, 200));
    const style = getComputedStyle(document.body);
    return { nonce: nonce.length > 0, outline: style.outlineStyle, decoration: style.textDecorationLine };
  });
  expect(result).toEqual({ nonce: true, outline: "none", decoration: "underline" });
});

test("switches between Chinese and English and remembers the choice", async ({ page, server }) => {
  await page.goto(await server.loginUrl());
  await page.getByTestId("open-settings").click();
  const select = page.getByTestId("locale-select");
  await select.selectOption("en");
  await expect(page.getByTestId("settings-page")).toContainText("General");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.getByTestId("locale-select")).toHaveValue("en");
  await select.selectOption("zh-CN");
  await expect(page.getByTestId("settings-page")).toContainText("通用");
});

test("a failed language save is reported", async ({ page, server }) => {
  await page.goto(await server.loginUrl());
  await page.route("**/api/settings", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 403, contentType: "application/json", body: '{"code":"request.bad_origin"}' })
      : route.continue(),
  );
  await page.getByTestId("open-settings").click();
  await page.getByTestId("locale-select").selectOption("en");
  await expect(page.getByTestId("save-error")).toContainText(/请求来源不被允许|origin is not allowed/);
});

test("without the session cookie the API refuses and the UI says so", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ADMIN}/`);
  await expect(page.getByTestId("health")).toContainText(/登录已失效|session has expired/);
  await context.close();
});
