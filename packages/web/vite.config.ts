import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev server (plan 3.3): fixed 127.0.0.1:47890; /api and the token link go to the server, which sees
// Host 127.0.0.1:47880 (changeOrigin) and Origin http://127.0.0.1:47890 (passed as --dev-origin).
const server = "http://127.0.0.1:47880";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    host: "127.0.0.1",
    port: 47890,
    strictPort: true,
    proxy: {
      "/api": { target: server, changeOrigin: true },
      "^/\\?token=": { target: server, changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
