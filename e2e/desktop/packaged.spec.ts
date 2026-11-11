import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron, expect, test } from "@playwright/test";

// The packaged app (plan M7 layer 4), after `pnpm package:desktop`; skipped when it has not been built.
const out = path.resolve(import.meta.dirname, "../../packages/desktop/out");
const app = {
  darwin: path.join(out, "BukitJalil-darwin-arm64/BukitJalil.app/Contents/MacOS/BukitJalil"),
  win32: path.join(out, "BukitJalil-win32-x64/BukitJalil.exe"),
  linux: path.join(out, "BukitJalil-linux-x64/BukitJalil"),
}[process.platform as string];

test.skip(!app || !fs.existsSync(app), "pnpm package:desktop first");

/**
 * What an app opened from Finder, the Start menu or a desktop launcher gets: the system PATH and nothing from
 * a shell profile. Windows keeps its own variables, which programs there cannot start without.
 */
function launchEnv(home: string): Record<string, string> {
  const base: Record<string, string> =
    process.platform === "win32"
      ? Object.fromEntries(
          ["PATH", "SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP"].flatMap((k) =>
            process.env[k] ? [[k, process.env[k] as string]] : [],
          ),
        )
      : {
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          // The X display, under xvfb-run on CI: its address and the cookie file that lets the app connect.
          ...Object.fromEntries(
            ["DISPLAY", "XAUTHORITY"].flatMap((k) => (process.env[k] ? [[k, process.env[k] as string]] : [])),
          ),
        };
  return {
    ...base,
    HOME: home,
    USERPROFILE: home,
    BUKITJALIL_HOME: path.join(home, ".bukitjalil"),
    BUKITJALIL_DESKTOP_PROFILE: path.join(home, "profile"),
    BUKITJALIL_DESKTOP_PORT: "49850",
  };
}

test("the packaged app runs its bundled server and creates a site from its own files", async () => {
  // HOME is the throwaway folder too, so the new site sits inside the user's home as the location rules want.
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-pkg-home-")));
  const electron = await _electron.launch({
    executablePath: app,
    // CI's Linux runners do not allow Chromium's sandbox (no user namespaces, no setuid helper).
    args: process.platform === "linux" && process.env.CI ? ["--no-sandbox"] : [],
    env: launchEnv(home),
  });
  const page = await electron.firstWindow();
  // When the server does not start, the window shows the status page with its error and last output lines.
  await expect(page.getByTestId("new-site"))
    .toBeVisible({ timeout: 30_000 })
    .catch(async (err: Error) => {
      const shown = await page
        .locator("body")
        // biome-ignore lint/performance/useDomNodeTextContent: the text as shown, not hidden template text
        .innerText()
        .catch(() => "(no page)");
      throw new Error(`${err.message}\n\nThe window shows:\n${shown}`);
    });

  const result = await page.evaluate(
    async (dir) => {
      const headers = { "content-type": "application/json", "x-bukitjalil": "1" };
      const settings = await fetch("/api/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({ commitName: "Desk Test", commitEmail: "desk@example.com" }),
      });
      const site = await fetch("/api/sites", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Packaged", path: dir, language: "en-US" }),
      });
      const health = await fetch("/api/health").then((r) => r.json());
      return { settings: settings.status, site: site.status, body: await site.json(), health };
    },
    path.join(home, "packaged-site"),
  );
  expect(result.settings).toBe(200);
  expect(result.site, JSON.stringify(result.body)).toBe(201);
  // The starter template came from the app's Resources folder and was committed with git.
  expect(fs.existsSync(path.join(home, "packaged-site/site.yaml"))).toBe(true);
  expect(fs.existsSync(path.join(home, "packaged-site/.git"))).toBe(true);
  expect(result.health).toMatchObject({ ok: true });

  // A conversation can start: the server found its AI skills in the app.
  const session = await page.evaluate(
    async (id) => {
      const res = await fetch(`/api/sites/${id}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-bukitjalil": "1" },
        body: "{}",
      });
      return res.status;
    },
    (result.body as { id: string }).id,
  );
  expect(session).toBe(201);
  // Pi SDK loads from the app's node_modules: its model catalog is there.
  const providers = await page.evaluate(
    async () => (await fetch("/api/models").then((r) => r.json())).providers.length,
  );
  expect(providers).toBeGreaterThan(5);
  await electron.close();
  expect(fs.existsSync(path.join(home, ".bukitjalil/server.lock"))).toBe(false);
});
