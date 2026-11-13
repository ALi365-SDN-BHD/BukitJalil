import { fetchBukit, latestBukitRelease } from "../src/bukit/fetch.ts";
import { BUKIT_VERSION, type BukitPackage, packageForPlatform, packageUrl } from "../src/bukit/install.ts";

/**
 * Fetch the official Bukit package for this platform (plan 8.1) into `<dir>/bukit-<version>/`, with the
 * checks in src/bukit/fetch.ts. Used by `pnpm fetch:bukit` (the development copy in vendor/), the desktop
 * packaging script and CI. Prints BUKIT_BIN= (and BUKIT_TARBALL= when the package is kept) for $GITHUB_ENV.
 *
 *   tsx scripts/fetch-bukit.ts <dir>                the release pinned in install.ts (BUKIT_VERSION)
 *   tsx scripts/fetch-bukit.ts <dir> --keep-package also keep the downloaded package as <dir>/<file>
 *   tsx scripts/fetch-bukit.ts <dir> --latest       the latest GitHub release, checked with the SHA-256
 *                                                   GitHub reports; only for bukit-latest.yml
 *
 * With --latest it also keeps the package, prints BUKIT_FETCHED_VERSION= and fails when GitHub cannot be
 * asked. GITHUB_TOKEN, when set, is sent to api.github.com only.
 */
const [dir, ...flags] = process.argv.slice(2);
const known = new Set(["--latest", "--keep-package"]);
if (!dir || flags.some((f) => !known.has(f)))
  throw new Error("usage: fetch-bukit.ts <dir> [--latest] [--keep-package]");
const latest = flags.includes("--latest");

const layout = packageForPlatform();
if (!layout) throw new Error(`no official Bukit package for ${process.platform}-${process.arch}`);
let version = BUKIT_VERSION;
let pkg: BukitPackage | null = layout;
let url = packageUrl(layout);
if (latest) {
  ({ version, pkg, url } = await latestBukitRelease({
    layout,
    pinnedVersion: BUKIT_VERSION,
    token: process.env.GITHUB_TOKEN,
  }));
}
if (!pkg) throw new Error(`no official Bukit ${version} package for ${process.platform}-${process.arch}`);

const { bin, tarball } = await fetchBukit({
  dir,
  pkg,
  url,
  version,
  keepPackage: latest || flags.includes("--keep-package"),
});
process.stdout.write(`BUKIT_BIN=${bin}\n`);
if (tarball) process.stdout.write(`BUKIT_TARBALL=${tarball}\n`);
if (latest) process.stdout.write(`BUKIT_FETCHED_VERSION=${version}\n`);
