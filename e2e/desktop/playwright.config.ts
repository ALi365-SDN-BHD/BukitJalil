import { defineConfig } from "@playwright/test";

// The desktop app (plan M7) through Playwright's Electron support: `pnpm e2e:desktop` builds the UI and
// the desktop bundle first. Electron must be installed (pnpm --filter @bukitjalil/desktop exec install-electron).
export default defineConfig({
  testDir: ".",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "list" : "line",
  timeout: 60_000,
  use: { trace: "retain-on-failure" },
});
