import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["desktop.spec.ts", "generation.spec.ts", "project-home.spec.ts", "settings.spec.ts"],
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
