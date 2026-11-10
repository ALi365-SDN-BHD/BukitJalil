// Builds BukitJalil.app for macOS arm64 (plan M7 layer 4) into packages/desktop/out/, with a zip next to it.
// Run `pnpm build` (the web UI) first; `pnpm package:desktop` does both.
//
// The app folder (Contents/Resources/app) holds:
//   main.cjs, preload.cjs, status.*   the desktop shell (scripts/build.mjs)
//   server.mjs, migrations/            BukitJalil's server code, bundled; npm packages stay outside the
//                                      bundle because Pi SDK reads files next to its own modules
//   node_modules/                      the server's production dependencies (pnpm deploy, lockfile versions)
//   skills/, templates/starter/, web/  read through BUKITJALIL_RESOURCES
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packager } from "@electron/packager";
import { build } from "esbuild";

const desktop = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(desktop, "../..");
const server = path.join(repo, "packages/server");
const out = path.join(desktop, "out");
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "bukitjalil-app-"));
const run = (cmd, args, cwd = repo) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

const web = path.join(repo, "packages/web/dist");
if (!fs.existsSync(path.join(web, "index.html"))) throw new Error("Build the web UI first: pnpm build");

// The shell.
run(process.execPath, [path.join(desktop, "scripts/build.mjs")]);
for (const file of fs.readdirSync(path.join(desktop, "dist"))) {
  if (file !== "dev-server.mjs") fs.copyFileSync(path.join(desktop, "dist", file), path.join(stage, file));
}

// The server: its own code and the workspace's shared package in one module, every npm package external.
const serverPkg = JSON.parse(fs.readFileSync(path.join(server, "package.json"), "utf8"));
const external = Object.keys(serverPkg.dependencies).filter((name) => !name.startsWith("@bukitjalil/"));
await build({
  entryPoints: [path.join(server, "src/main.ts")],
  outfile: path.join(stage, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: external.flatMap((name) => [name, `${name}/*`]),
  logLevel: "warning",
});
fs.cpSync(path.join(server, "src/store/migrations"), path.join(stage, "migrations"), { recursive: true });

// Its dependencies, as the lockfile has them.
const deployed = fs.mkdtempSync(path.join(os.tmpdir(), "bukitjalil-deploy-"));
fs.rmSync(deployed, { recursive: true });
// Hoisted: plain folders, since the packager copies symlinks as full copies (pnpm's layout tripled the size).
run("pnpm", [
  "--filter",
  "@bukitjalil/server",
  "deploy",
  "--prod",
  "--legacy",
  "--config.node-linker=hoisted",
  deployed,
]);
fs.renameSync(path.join(deployed, "node_modules"), path.join(stage, "node_modules"));
// Bundled into server.mjs, or only for running the sources (tsx).
for (const name of ["@bukitjalil", "tsx", ".bin"])
  fs.rmSync(path.join(stage, "node_modules", name), { recursive: true, force: true });
fs.rmSync(deployed, { recursive: true, force: true });

// Files the server reads.
fs.cpSync(path.join(repo, "skills"), path.join(stage, "skills"), { recursive: true });
fs.cpSync(path.join(repo, "templates/starter"), path.join(stage, "templates/starter"), { recursive: true });
fs.cpSync(web, path.join(stage, "web"), { recursive: true });

const version = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version ?? "0.0.0";
fs.writeFileSync(
  path.join(stage, "package.json"),
  `${JSON.stringify({ name: "bukitjalil", productName: "BukitJalil", version, main: "main.cjs", private: true }, null, 2)}\n`,
);

const electronVersion = JSON.parse(
  fs.readFileSync(path.join(desktop, "node_modules/electron/package.json"), "utf8"),
).version;
fs.rmSync(out, { recursive: true, force: true });
const [appDir] = await packager({
  dir: stage,
  out,
  name: "BukitJalil",
  platform: "darwin",
  arch: "arm64",
  electronVersion,
  appBundleId: "my.ali365.bukitjalil",
  appCategoryType: "public.app-category.developer-tools",
  appVersion: version,
  // The server runs git and copies templates from these folders, so they stay plain files.
  asar: false,
  // The stage holds production dependencies only.
  prune: false,
  overwrite: true,
  quiet: true,
});
fs.rmSync(stage, { recursive: true, force: true });

const app = path.join(appDir, "BukitJalil.app");
// Apple Silicon only runs signed code. Without a Developer ID the app is signed ad hoc again as a whole:
// Electron's own signature no longer matches once the app's files are added, and macOS would call a
// downloaded copy damaged. Gatekeeper still asks the user to allow it (docs/user-guide.md).
run("codesign", ["--force", "--deep", "--sign", "-", app]);
run("codesign", ["--verify", "--deep", "--strict", app]);
const zip = path.join(out, `BukitJalil-${version}-mac-arm64.zip`);
run("ditto", ["-c", "-k", "--keepParent", app, zip]);
console.log(`${app}\n${zip}`);
