import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeBukit } from "./fake-bukit.ts";
import { expect, test } from "./fixtures.ts";
import { importSite, putSettings, removeImportedSites, siteFolder } from "./site-helpers.ts";

// M6 (plan 14): the Publish section shows the target from site.yaml on the default branch and whether the
// GitHub token is set; without a target, the AI is asked to set it in a new conversation. Publishing asks for
// confirmation, shows its steps, and keeps a record with the publish audit.

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
  await putSettings(page, { bukitPath: null, commitName: null, commitEmail: null });
  await page.evaluate(() =>
    fetch("/api/secrets/github", { method: "DELETE", headers: { "X-BukitJalil": "1" } }).then(() => undefined),
  );
  await page.close();
  removeImportedSites();
  fs.rmSync(work, { recursive: true, force: true });
});

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=E2E", "-c", "user.email=e2e@example.com", ...args], {
    cwd: dir,
    env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1" },
  });

test("the publish target comes from site.yaml, and the AI is asked to set it", async ({ page, server }) => {
  await page.goto(await server.loginUrl());
  await putSettings(page, { bukitPath: bukitBin, commitName: "Test Owner", commitEmail: "owner@example.com" });
  const siteId = await importSite(page, "Deploy");
  await page.goto(`/sites/${siteId}`);
  const section = page.getByTestId("deploy-section");
  await expect(section.getByTestId("deploy-problem")).toBeVisible();
  await expect(section).toContainText(/GitHub token/);

  // The draft lands in a new conversation's input, for the user to finish and send.
  await section.getByTestId("deploy-ask-ai").click();
  await expect(page.getByTestId("chat-view")).toBeVisible();
  await expect(page.getByTestId("composer-input")).toHaveValue(/GitHub Pages/);

  // A target on the default branch, and a token: ready.
  const dir = siteFolder(siteId);
  fs.appendFileSync(
    path.join(dir, "site.yaml"),
    "\ndeploy:\n  provider: github-pages\n  repo: someone/someone.github.io\n",
  );
  git(dir, "commit", "-qam", "Publish to GitHub Pages");
  await page.evaluate(() =>
    fetch("/api/secrets/github", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-BukitJalil": "1" },
      body: JSON.stringify({ value: "ghp_e2edeploytoken4321" }),
    }).then(() => undefined),
  );
  await page.goto(`/sites/${siteId}`);
  const target = section.getByTestId("deploy-target");
  await expect(target).toContainText("someone/someone.github.io");
  await expect(target).toContainText("gh-pages");
  await expect(target).toContainText("https://someone.github.io/");
  await expect(section.getByTestId("deploy-ask-ai")).toHaveCount(0);
  await expect(section.getByTestId("deploy-open-settings")).toHaveCount(0);

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
