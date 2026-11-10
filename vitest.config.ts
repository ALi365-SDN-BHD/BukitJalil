import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web package imports through "@/..." (its vite.config.ts alias).
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "packages/web/src") } },
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    environment: "node",
  },
});
