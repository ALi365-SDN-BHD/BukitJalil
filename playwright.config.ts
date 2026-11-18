import fs from "node:fs";
import os from "node:os";
import { defineConfig, devices } from "@playwright/test";
import { ADMIN } from "./e2e/ports.ts";

// On Windows os.tmpdir() can be an 8.3 short path (C:\Users\RUNNER~1\...) while the app reports the long one, so
// expected paths would differ in spelling only. The workers inherit this environment.
if (process.platform === "win32") {
  const real = fs.realpathSync.native(os.tmpdir());
  process.env.TEMP = real;
  process.env.TMP = real;
}

// End-to-end tests against the real server and the built UI (`pnpm build` first), in Playwright's own
// Chromium, Firefox and WebKit (CI installs them; locally `pnpm exec playwright install`).
// One worker, so each browser project gets one server (worker fixture in e2e/fixtures.ts) on fixed ports.
export default defineConfig({
  testDir: "e2e",
  // The desktop app has its own config (e2e/desktop/playwright.config.ts).
  testIgnore: "desktop/**",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "list" : "line",
  use: { baseURL: ADMIN, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
