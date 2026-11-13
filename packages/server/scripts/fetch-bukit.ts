import fs from "node:fs";
import path from "node:path";
import {
  BUKIT_VERSION,
  type BukitPackage,
  download,
  FALLBACK_RELEASE,
  fetchLatestRelease,
  installFiles,
  packageForPlatform,
  packageUrl,
  readStrictTarGz,
  verifySha256,
} from "../src/bukit/install.ts";

/**
 * CI (plan M5 layer 4): fetch the official Bukit package for this platform with the app's own installer
 * code — SHA-256 check, strict unpacking — into `<dir>/bukit-<version>/`, and keep the package as
 * `<dir>/<file>` for the install tests. Prints BUKIT_BIN= and BUKIT_TARBALL= lines for $GITHUB_ENV.
 *
 *   tsx scripts/fetch-bukit.ts <dir>            the release pinned in install.ts (BUKIT_VERSION)
 *   tsx scripts/fetch-bukit.ts <dir> --latest   the latest GitHub release, checked with the SHA-256 GitHub
 *                                               reports, as the app installs it (plan 8.1, 16 #7)
 *
 * With --latest it also prints BUKIT_FETCHED_VERSION=, and fails rather than fall back to the pinned
 * release when GitHub cannot be asked. GITHUB_TOKEN, when set, is sent to api.github.com only.
 */
const [dir, flag] = process.argv.slice(2);
if (!dir || (flag !== undefined && flag !== "--latest")) throw new Error("usage: fetch-bukit.ts <dir> [--latest]");
const latest = flag === "--latest";

let version = BUKIT_VERSION;
let pkg: BukitPackage | null = packageForPlatform();
let url = pkg ? packageUrl(pkg) : "";
if (latest) {
  const token = process.env.GITHUB_TOKEN;
  const authed: typeof fetch = (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (!token || target.hostname !== "api.github.com") return fetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  const release = await fetchLatestRelease(authed, 30_000);
  if (release === FALLBACK_RELEASE) throw new Error("could not read the latest Bukit release from GitHub");
  const asset = release.assets[`${process.platform}-${process.arch}`];
  version = release.version;
  pkg = asset ?? null;
  url = asset?.url ?? "";
}
if (!pkg) throw new Error(`no official Bukit ${version} package for ${process.platform}-${process.arch}`);

const root = path.resolve(dir);
fs.mkdirSync(root, { recursive: true });
const data = await download(url, () => {});
verifySha256(data, pkg.sha256);
const tarball = path.join(root, pkg.file);
fs.writeFileSync(tarball, data);
const target = path.join(root, `bukit-${version}`);
installFiles(readStrictTarGz(data, pkg.files), target, pkg.executable);

process.stdout.write(`BUKIT_BIN=${path.join(target, pkg.executable)}\nBUKIT_TARBALL=${tarball}\n`);
if (latest) process.stdout.write(`BUKIT_FETCHED_VERSION=${version}\n`);
