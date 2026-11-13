// Builds the desktop app for the platform it runs on (plan M7) into packages/desktop/out/, then its installers
// into out/installers/: a dmg and a zip on macOS (arm64), an NSIS setup on Windows (x64), an AppImage and a deb
// on Linux (x64). Electron cannot be packaged for another platform reliably (npm packages with native code),
// so the release workflow runs this once per platform. Run `pnpm build` (the web UI) first;
// `pnpm package:desktop` does both. BUKITJALIL_VERSION sets the version (the release tag without its "v").
//
// The app folder (BukitJalil.app/Contents/Resources/app, resources/app elsewhere) holds:
//   main.cjs, preload.cjs, status.*   the desktop shell (scripts/build.mjs)
//   server.mjs, migrations/            BukitJalil's server code, bundled; npm packages stay outside the
//                                      bundle because Pi SDK reads files next to its own modules
//   node_modules/                      the server's production dependencies (pnpm deploy, lockfile versions)
//   skills/, templates/starter/, web/  read through BUKITJALIL_RESOURCES
//   bukit/                             the pinned Bukit (plan 8.1), checked against the SHA-256 in the
//                                      server's bukit/install.ts; the app never installs another
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packager } from "@electron/packager";
import { Arch, build as buildInstallers, Platform } from "electron-builder";
import { build } from "esbuild";

const desktop = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(desktop, "../..");
const server = path.join(repo, "packages/server");
const out = path.join(desktop, "out");
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "bukitjalil-app-"));
// pnpm is a .cmd script on Windows, which Node only starts through a shell; paths with spaces (a user name
// in the temporary folder) are quoted for it.
const run = (cmd, args, cwd = repo) => {
  const shell = process.platform === "win32" && cmd === "pnpm";
  const argv = shell ? args.map((a) => (/[\s&^|<>()]/.test(a) ? `"${a}"` : a)) : args;
  execFileSync(cmd, argv, { cwd, stdio: "inherit", shell });
};

const TARGETS = {
  darwin: { arch: "arm64", builder: Platform.MAC, formats: ["dmg", "zip"] },
  win32: { arch: "x64", builder: Platform.WINDOWS, formats: ["nsis"] },
  linux: { arch: "x64", builder: Platform.LINUX, formats: ["AppImage", "deb"] },
};
const target = TARGETS[process.platform];
// Bukit's official builds (plan 8.1) are the same three; elsewhere the app could not build any site.
if (!target || process.arch !== target.arch) {
  throw new Error(`Packaging runs on macOS arm64, Windows x64 or Linux x64, not ${process.platform} ${process.arch}`);
}
const version =
  process.env.BUKITJALIL_VERSION ||
  JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version ||
  "0.0.0";
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Not a version: ${version}`);

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
// Bukit ships with the app (plan 8.1): the release pinned in install.ts, fetched and checked (SHA-256, strict
// unpacking, `bukit version`) by the server's own script.
const fetched = fs.mkdtempSync(path.join(os.tmpdir(), "bukitjalil-bukit-"));
try {
  const fetchArgs = ["--filter", "@bukitjalil/server", "exec", "tsx", "scripts/fetch-bukit.ts", fetched];
  const winShell = process.platform === "win32";
  const fetchOut = execFileSync(
    "pnpm",
    winShell ? fetchArgs.map((a) => (/[\s&^|<>()]/.test(a) ? `"${a}"` : a)) : fetchArgs,
    {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      shell: winShell,
    },
  );
  const bukitBin = /^BUKIT_BIN=(.+)$/m.exec(fetchOut)?.[1]?.trim();
  if (!bukitBin || !fs.existsSync(bukitBin)) throw new Error(`fetching Bukit printed no executable:\n${fetchOut}`);
  fs.cpSync(path.dirname(bukitBin), path.join(stage, "bukit"), { recursive: true });
  // Readable by everyone: a root-owned install (/opt, a .deb) must still let the user run Bukit.
  fs.chmodSync(path.join(stage, "bukit"), 0o755);
} finally {
  fs.rmSync(fetched, { recursive: true, force: true });
}
fs.cpSync(path.join(repo, "templates/starter"), path.join(stage, "templates/starter"), { recursive: true });
fs.cpSync(web, path.join(stage, "web"), { recursive: true });
// The window icon on Windows and Linux, read next to main.cjs.
const assets = path.join(desktop, "assets");
fs.copyFileSync(path.join(assets, "icon.png"), path.join(stage, "icon.png"));

const description = "Build and publish websites by talking to an AI";
const homepage = "https://github.com/ALi365-SDN-BHD/BukitJalil";
fs.writeFileSync(
  path.join(stage, "package.json"),
  `${JSON.stringify({ name: "bukitjalil", productName: "BukitJalil", version, description, homepage, author: "ALi365 SDN BHD", main: "main.cjs", private: true }, null, 2)}\n`,
);

const electronVersion = JSON.parse(
  fs.readFileSync(path.join(desktop, "node_modules/electron/package.json"), "utf8"),
).version;
fs.rmSync(out, { recursive: true, force: true });
const [appDir] = await packager({
  dir: stage,
  out,
  name: "BukitJalil",
  platform: process.platform,
  arch: target.arch,
  electronVersion,
  appBundleId: "my.ali365.bukitjalil",
  appCategoryType: "public.app-category.developer-tools",
  appVersion: version,
  // The app and its executable: an .icns on macOS, an .ico on Windows (Linux takes the installers' icon).
  ...(process.platform === "darwin" ? { icon: path.join(assets, "icon.icns") } : {}),
  ...(process.platform === "win32" ? { icon: path.join(assets, "icon.ico") } : {}),
  // The server runs git and copies templates from these folders, so they stay plain files.
  asar: false,
  // The stage holds production dependencies only.
  prune: false,
  overwrite: true,
  quiet: true,
});

let prepackaged = appDir;
if (process.platform === "darwin") {
  prepackaged = path.join(appDir, "BukitJalil.app");
  // The packager keeps Electron's file name for the icon. macOS caches icons by that name, so a copy that
  // once showed another picture (Electron's, or a broken render) kept showing it; our own name avoids that.
  const contents = path.join(prepackaged, "Contents");
  fs.renameSync(path.join(contents, "Resources/electron.icns"), path.join(contents, "Resources/BukitJalil.icns"));
  run("plutil", ["-replace", "CFBundleIconFile", "-string", "BukitJalil.icns", path.join(contents, "Info.plist")]);
  // Apple Silicon only runs signed code. Without a Developer ID the app is signed ad hoc again as a whole:
  // Electron's own signature no longer matches once the app's files are added, and macOS would call a
  // downloaded copy damaged. Gatekeeper still asks the user to allow it (docs/user-guide.md).
  run("codesign", ["--force", "--deep", "--sign", "-", prepackaged]);
  run("codesign", ["--verify", "--deep", "--strict", prepackaged]);
}

// The installers wrap the app built above as it is: electron-builder does not package or sign it again.
const installers = path.join(out, "installers");
const files = await buildInstallers({
  prepackaged,
  projectDir: stage,
  targets: target.builder.createTarget(target.formats, Arch[target.arch]),
  publish: "never",
  config: {
    appId: "my.ali365.bukitjalil",
    productName: "BukitJalil",
    executableName: "BukitJalil",
    electronVersion,
    directories: { output: installers },
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder fills in these macros
    artifactName: "BukitJalil-${version}-${os}-${arch}.${ext}",
    npmRebuild: false,
    // No Developer ID: keep the ad hoc signature made above.
    mac: { identity: null, category: "public.app-category.developer-tools", icon: path.join(assets, "icon.icns") },
    win: { icon: path.join(assets, "icon.ico") },
    // Per user, no administrator rights; the user may pick the folder.
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      installerIcon: path.join(assets, "icon.ico"),
      uninstallerIcon: path.join(assets, "icon.ico"),
    },
    linux: {
      category: "Development",
      maintainer: "ALi365 SDN BHD",
      synopsis: description,
      icon: path.join(assets, "icon.png"),
    },
  },
});
fs.rmSync(stage, { recursive: true, force: true });
const made = files.filter((f) => !f.endsWith(".blockmap") && !f.endsWith(".yml"));
console.log([prepackaged, ...made].join("\n"));
