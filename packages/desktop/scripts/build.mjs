// Bundles the main process and the preload script (CommonJS: a sandboxed preload cannot be a module) and
// copies the local status page next to them.
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist");
fs.rmSync(out, { recursive: true, force: true });
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  logLevel: "warning",
};
await build({ ...common, entryPoints: [path.join(root, "src/main.ts")], outfile: path.join(out, "main.cjs") });
await build({ ...common, entryPoints: [path.join(root, "src/preload.ts")], outfile: path.join(out, "preload.cjs") });
for (const file of ["status.html", "status.js", "dev-server.mjs"])
  fs.copyFileSync(path.join(root, "static", file), path.join(out, file));
