import fs from "node:fs";
import path from "node:path";
import {
  BUKIT_VERSION,
  download,
  installFiles,
  packageForPlatform,
  packageUrl,
  readStrictTarGz,
  verifySha256,
} from "../src/bukit/install.ts";

/**
 * CI (plan M5 layer 4): fetch the official Bukit package for this platform with the app's own installer
 * code — pinned SHA-256, strict unpacking — into `<dir>/bukit-<version>/`, and keep the package as
 * `<dir>/<file>` for the install tests. Prints BUKIT_BIN= and BUKIT_TARBALL= lines for $GITHUB_ENV.
 *
 *   tsx scripts/fetch-bukit.ts <dir>
 */
const dir = process.argv[2];
if (!dir) throw new Error("usage: fetch-bukit.ts <dir>");
const pkg = packageForPlatform();
if (!pkg) throw new Error(`no official Bukit ${BUKIT_VERSION} package for ${process.platform}-${process.arch}`);

const root = path.resolve(dir);
fs.mkdirSync(root, { recursive: true });
const data = await download(packageUrl(pkg), () => {});
verifySha256(data, pkg.sha256);
const tarball = path.join(root, pkg.file);
fs.writeFileSync(tarball, data);
const target = path.join(root, `bukit-${BUKIT_VERSION}`);
installFiles(readStrictTarGz(data, pkg.files), target, pkg.executable);

process.stdout.write(`BUKIT_BIN=${path.join(target, pkg.executable)}\nBUKIT_TARBALL=${tarball}\n`);
