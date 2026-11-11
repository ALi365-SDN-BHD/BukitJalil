import { defineConfig, devices } from "@playwright/test";
import { ADMIN } from "./e2e/ports.ts";

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
