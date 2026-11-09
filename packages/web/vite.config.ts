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
  // Vite writes this placeholder into index.html and a <meta property="csp-nonce">; the server swaps in a
  // fresh nonce per response (CSP_NONCE_PLACEHOLDER in packages/server/src/security/headers.ts).
  html: { cspNonce: "BJ_CSP_NONCE" },
  server: {
    host: "127.0.0.1",
    port: 47890,
    strictPort: true,
    // Same rules as the admin port (plan 11): no CORS (preflights go through to the server, which refuses
    // them) and no framing by preview pages.
    cors: false,
    headers: {
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
    },
    proxy: {
      "/api": { target: server, changeOrigin: true },
      "^/\\?token=": { target: server, changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
