import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { copyStarter } from "../packages/server/src/sites/template.ts";

const STARTER = path.resolve(import.meta.dirname, "../templates/starter");
let work: string | null = null;
let counter = 0;
const folders = new Map<string, string>();

/** Change settings through the API, as the UI does (same origin, all headers); fails on an error status. */
export async function putSettings(page: Page, body: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (b) => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-BukitJalil": "1" },
      body: JSON.stringify(b),
    });
    if (!res.ok) throw new Error(`settings: ${res.status}`);
  }, body);
}

/** A committed starter site in a temp folder, imported through the API; returns its id. */
export async function importSite(page: Page, title = "Chat", language = "en-US"): Promise<string> {
  work ??= fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-e2e-sites-")));
  const dir = path.join(work, `site${++counter}`);
  copyStarter(STARTER, dir, { title: `${title} ${counter}`, language });
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=E2E", "-c", "user.email=e2e@example.com", ...args], {
      cwd: dir,
      stdio: "pipe",
      env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1" },
    });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const id = await page.evaluate(async (p) => {
    const res = await fetch("/api/sites/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BukitJalil": "1" },
      body: JSON.stringify({ path: p }),
    });
    if (!res.ok) throw new Error(`import: ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  }, dir);
  folders.set(id, dir);
  return id;
}

/** The folder of a site imported with importSite. */
export function siteFolder(id: string): string {
  const dir = folders.get(id);
  if (!dir) throw new Error(`not imported here: ${id}`);
  return dir;
}

/** Remove the temp folder of the imported sites (call in afterAll). */
export function removeImportedSites(): void {
  if (work) fs.rmSync(work, { recursive: true, force: true });
  work = null;
  folders.clear();
}
