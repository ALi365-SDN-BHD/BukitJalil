import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type BukitPackage, download, InstallError, installFiles, readPackage, verifySha256 } from "./install.ts";
import { probeBukitVersion } from "./locate.ts";

/**
 * Fetch one official Bukit package into `<dir>/bukit-<version>/` (plan 8.1): download, SHA-256 check,
 * strict unpacking, then `bukit version` must print `version`. Only for packaging, `pnpm fetch:bukit` and CI
 * (scripts/fetch-bukit.ts); the app never calls it. The folder is left readable by everyone (0755), so a
 * root-owned install (/opt, a .deb) still lets the user run Bukit.
 */
export async function fetchBukit(opts: {
  dir: string;
  pkg: BukitPackage;
  url: string;
  version: string;
  keepPackage?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ bin: string; tarball: string | null }> {
  const root = path.resolve(opts.dir);
  fs.mkdirSync(root, { recursive: true });
  const data = await download(opts.url, () => {}, opts.fetchImpl);
  verifySha256(data, opts.pkg.sha256);
  const files = readPackage(opts.pkg, data);
  let tarball: string | null = null;
  if (opts.keepPackage) {
    tarball = path.join(root, opts.pkg.file);
    fs.writeFileSync(tarball, data);
  }
  const target = path.join(root, `bukit-${opts.version}`);
  installFiles(files, target, opts.pkg.executable);
  fs.chmodSync(target, 0o755);
  const bin = path.join(target, opts.pkg.executable);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bukit-fetch-"));
  try {
    const printed = await probeBukitVersion(bin, tmp);
    if (printed !== opts.version) {
      fs.rmSync(target, { recursive: true, force: true });
      throw new InstallError(
        "verify_failed",
        `${bin} printed version ${printed ?? "nothing"}, expected ${opts.version}`,
      );
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { bin, tarball };
}

/**
 * The latest GitHub release's package for this platform, checked with the digest GitHub reports. Only for
 * the daily CI that warns of Bukit changes (bukit-latest.yml); the app never uses it. Throws when GitHub
 * cannot be read; `pkg` is null when the release has no usable package for `key`.
 */
export async function latestBukitRelease(opts: {
  layout: BukitPackage;
  pinnedVersion: string;
  fetchImpl?: typeof fetch;
  token?: string;
}): Promise<{ version: string; pkg: BukitPackage | null; url: string }> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "BukitJalil" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await (opts.fetchImpl ?? fetch)("https://api.github.com/repos/ALi365-SDN-BHD/Bukit/releases/latest", {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`could not read the latest Bukit release from GitHub: ${res.status}`);
  const json = (await res.json()) as {
    tag_name?: string;
    assets?: { name?: string; browser_download_url?: string; digest?: string | null }[];
  };
  const version = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(json.tag_name ?? "")?.[1];
  if (!version) throw new Error(`not a Bukit release tag: ${json.tag_name ?? "none"}`);
  const file = opts.layout.file.replace(opts.pinnedVersion, version);
  const asset = json.assets?.find((a) => a.name === file);
  const sha256 = asset?.digest?.startsWith("sha256:") ? asset.digest.slice("sha256:".length) : "";
  if (!asset?.browser_download_url || !/^[0-9a-f]{64}$/.test(sha256)) return { version, pkg: null, url: "" };
  return { version, pkg: { ...opts.layout, file, sha256 }, url: asset.browser_download_url };
}
