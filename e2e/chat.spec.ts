import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { copyStarter } from "../packages/server/src/sites/template.ts";
import { expect, test } from "./fixtures.ts";

// M3 layer 6 (plan 10.1, 10.2): conversations in the sidebar and the chat view, kept in step across tabs by
// the event stream. No model is set up in end-to-end runs, so sending a message shows agent.no_model.

const STARTER = path.resolve(import.meta.dirname, "../templates/starter");
let work: string;
let counter = 0;

test.beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-e2e-chat-")));
});
test.afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

/** A committed starter site, imported through the API; returns its id. */
async function importSite(page: Page): Promise<string> {
  const dir = path.join(work, `site${++counter}`);
  copyStarter(STARTER, dir, { title: `Chat ${counter}`, language: "en-US" });
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=E2E", "-c", "user.email=e2e@example.com", ...args], {
      cwd: dir,
      stdio: "pipe",
      env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1" },
    });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return page.evaluate(async (p) => {
    const res = await fetch("/api/sites/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BukitJalil": "1" },
      body: JSON.stringify({ path: p }),
    });
    if (!res.ok) throw new Error(`import: ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  }, dir);
}

test("conversations: start, send, rename and delete, with a second tab kept in step", async ({ page, server }) => {
  await page.goto(await server.loginUrl());
  const siteId = await importSite(page);
  await page.goto(`/sites/${siteId}`);
  await page.getByTestId("start-conversation").click();
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/sessions/[0-9a-f]{16}$`));
  await expect(page.getByTestId("chat-view")).toBeVisible();
  const items = page.getByTestId("session-list").getByTestId("session-item");
  await expect(items).toHaveCount(1);

  // A second tab of the same browser shares the login and has its own event stream.
  const other = await page.context().newPage();
  await other.goto(`/sites/${siteId}`);
  await expect(other.getByTestId("session-list").getByTestId("session-item")).toHaveCount(1);

  // No model in end-to-end runs: the message is refused and stays in the box.
  const input = page.getByTestId("composer-input");
  await input.fill("Change the home page title");
  await input.press("Enter");
  await expect(page.getByTestId("composer-error")).toHaveText(/model|模型/, { timeout: 20_000 });
  await expect(input).toHaveValue("Change the home page title");

  // Rename: shown here at once, and in the other tab through the event stream.
  await page.getByTestId("rename-session").click();
  await page.getByTestId("rename-input").fill("Home page title");
  await page.getByTestId("rename-save").click();
  await expect(page.getByTestId("chat-title")).toHaveText("Home page title");
  await expect(other.getByTestId("session-list").getByTestId("session-item")).toHaveText("Home page title");

  // A conversation started in the other tab shows up here.
  await other.getByTestId("new-session").click();
  await expect(other).toHaveURL(/\/sessions\/[0-9a-f]{16}$/);
  await expect(items).toHaveCount(2);

  // Delete: back to the site home here, and gone from the other tab's list.
  await page.getByTestId("delete-session").click();
  await page.getByTestId("delete-confirm").click();
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}$`));
  await expect(items).toHaveCount(1);
  await expect(other.getByTestId("session-list").getByTestId("session-item")).toHaveCount(1);
  await expect(other.getByTestId("session-list").getByTestId("session-item")).not.toHaveText("Home page title");
  await other.close();
});
