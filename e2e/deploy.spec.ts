import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeBukit } from "./fake-bukit.ts";
import { expect, test } from "./fixtures.ts";
import { importSite, putSettings, removeImportedSites, siteFolder } from "./site-helpers.ts";

// M6 (plan 14): the Publish section reads the target from site.yaml, the saved publishing account is picked
// in the deploy settings, and publishing asks for confirmation before running its steps and keeping a record.

let work: string;
let bukitBin: string;

test.beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-e2e-deploy-")));
  // Always the stand-in: a real Bukit would push to GitHub.
  bukitBin = fakeBukit(work);
});

test.afterAll(async ({ browser, server }) => {
  const page = await browser.newPage();
  await page.goto(await server.loginUrl());
  await putSettings(page, { commitName: null, commitEmail: null });
  await page.close();
  removeImportedSites();
  fs.rmSync(work, { recursive: true, force: true });
});

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=E2E", "-c", "user.email=e2e@example.com", ...args], {
    cwd: dir,
    env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1" },
  });

test("the deploy settings save the account and repository, then publishing uses them", async ({ page, server }) => {
  await page.goto(await server.loginUrl());
  server.setBukit(bukitBin);
  await page.evaluate(() => fetch("/api/bukit?refresh=1"));
  await putSettings(page, { commitName: "Test Owner", commitEmail: "owner@example.com" });

  // A saved GitHub account is the one this site will publish with.
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-nav-publishing").click();
  await page.getByTestId("publish-account-add").click();
  await page.getByTestId("publish-account-name").fill("E2E Deploy GitHub");
  await page.getByTestId("publish-account-token").fill("ghp_e2edeploytoken4321");
  await page.getByTestId("publish-account-save").click();
  const accountRow = page.getByTestId(/^publish-account-pub_[0-9a-f]{12}$/).filter({ hasText: "E2E Deploy GitHub" });
  await expect(accountRow).toContainText(/Token saved|已保存 token/);
  const accountId = (await accountRow.getAttribute("data-testid"))?.replace("publish-account-", "") ?? "";
  expect(accountId).toMatch(/^pub_/);
  await page.getByTestId("settings-close").click();

  const siteId = await importSite(page, "Deploy");
  await page.goto(`/sites/${siteId}`);
  await expect(page.getByTestId("build-list").getByTestId("build-status").first()).toHaveText(/Succeeded|成功/, {
    timeout: 60_000,
  });
  const section = page.getByTestId("deploy-section");
  const dir = siteFolder(siteId);
  const siteYaml = path.join(dir, "site.yaml");
  expect(fs.readFileSync(siteYaml, "utf8")).not.toContain("deploy:");

  await section.getByTestId("deploy-settings").click();
  await page.getByTestId("deploy-account").selectOption(accountId);
  await page.getByTestId("deploy-repo").fill("someone/someone.github.io");
  await page.getByTestId("deploy-settings-save").click();
  await expect(page.getByTestId("deploy-account")).toHaveCount(0);
  await expect(section.getByTestId("deploy-target")).toContainText("someone/someone.github.io");
  await expect(section.getByTestId("deploy-target")).toContainText("gh-pages");
  await expect(section.getByTestId("deploy-target")).toContainText("https://someone.github.io/");
  await expect(section).toContainText("E2E Deploy GitHub");
  expect(fs.readFileSync(siteYaml, "utf8")).toContain("repo: someone/someone.github.io");

  // Publishing: the confirmation names the repository, branch and version.
  const head = git(dir, "rev-parse", "--short=7", "HEAD").toString().trim();
  await section.getByTestId("deploy-start").click();
  const confirm = page.getByTestId("deploy-confirm");
  await expect(confirm).toContainText("github.com/someone/someone.github.io");
  await expect(confirm).toContainText("gh-pages");
  await expect(confirm).toContainText(head);
  await page.getByTestId("deploy-confirm-start").click();
  await expect(section.getByTestId("deploy-progress")).toBeVisible();
  await expect(section.getByTestId("deploy-start")).toBeDisabled();
  await expect(section.getByTestId("deploy-step-deploy")).toHaveAttribute("data-state", "running");
  await expect(section.getByTestId("deploy-progress")).toHaveCount(0, { timeout: 30_000 });
  const record = section.getByTestId("deploy-list").getByTestId("deploy-status").first();
  await expect(record).toHaveText(/Published|已发布/);

  await record.click();
  const report = page.getByTestId("deploy-report");
  await expect(report.getByTestId("deploy-url")).toContainText("https://someone.github.io/");
  await expect(report.getByTestId("deploy-audit")).toContainText("publish.time_missing");
  await expect(report).toContainText("Git push completed");
});
