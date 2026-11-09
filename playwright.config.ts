import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against the real server and the built UI (`pnpm build` first).
// One worker, so each browser project gets one server (worker fixture in e2e/fixtures.ts) on fixed ports.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "list" : "line",
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
