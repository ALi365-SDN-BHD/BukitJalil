import { build as bundle } from "esbuild";
import { build as vite } from "vite";

await vite({
  root: "src/renderer",
  base: "./",
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
});
await bundle({
  entryPoints: ["src/main/main.ts", "src/main/preload.ts"],
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  target: "node22",
});
