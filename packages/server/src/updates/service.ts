import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  AppUpdateAsset,
  AppUpdateFormat,
  AppUpdateRelease,
  AppUpdateResponse,
  AppUpdateState,
  ErrorCode,
} from "@bukitjalil/shared";
import semver from "semver";
import type { Logger } from "../log.ts";

const RELEASES_URL = "https://api.github.com/repos/ALi365-SDN-BHD/BukitJalil/releases?per_page=20";
/** A successful or failed lookup is reused for this long; manual checks bypass it. */
const UPDATE_CACHE_MS = 10 * 60_000;
const GITHUB_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);

interface GitHubAsset {
  name?: unknown;
  size?: unknown;
  browser_download_url?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  /** Where downloaded installers are kept, inside the app data directory. */
  dir: string;
  /** null in tests and offline mode. */
  fetchImpl: typeof fetch | null;
  logger: Logger;
  /** Handed to the desktop app's main process; resolves to an error message, or null on success. */
  openInstaller: ((file: string) => Promise<string | null>) | null;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Linux install format; omitted follows APPIMAGE, then deb. */
  linuxPackage?: "appimage" | "deb";
  now?: () => number;
}

class UpdateProblem extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

/**
 * Checks GitHub Releases and downloads the matching installer. Installation is deliberately manual:
 * the desktop app opens the downloaded file and the user finishes it. This works without a Developer ID,
 * which macOS requires for Squirrel.Mac's in-app installation.
 */
export class UpdateService {
  private state: AppUpdateState = { phase: "idle" };
  private checkedAt: string | null = null;
  private checkedAtMs = 0;
  private release: AppUpdateRelease | null = null;
  private controller: AbortController | null = null;
  private downloadTask: Promise<void> | null = null;

  constructor(private readonly opts: UpdateServiceOptions) {
    // After the app was updated, the installer for the running (or older) version is no longer needed.
    void this.cleanup();
  }

  status(): AppUpdateResponse {
    return { currentVersion: this.opts.currentVersion, checkedAt: this.checkedAt, state: this.state };
  }

  /** Remove interrupted `.part` files and obsolete installers; called at startup. */
  async cleanup(): Promise<void> {
    await this.pruneInstalled();
  }

  /**
   * Look for a newer release. `reportFailure` is false for the automatic startup and six-hour checks:
   * a network failure there must not turn the footer into a retry button.
   */
  async check(force = false, reportFailure = true): Promise<AppUpdateResponse> {
    const now = this.now();
    if (this.state.phase === "checking" || this.state.phase === "downloading" || this.state.phase === "verifying")
      return this.status();
    if (this.state.phase === "downloaded" || this.downloadTask) return this.status();
    if (!force && this.checkedAtMs > 0 && now - this.checkedAtMs < UPDATE_CACHE_MS) return this.status();
    if (!this.opts.fetchImpl) {
      if (force && reportFailure) this.fail("check", "update.offline");
      return this.status();
    }

    this.setState({ phase: "checking" });
    try {
      const releases = await this.fetchReleases();
      const release = await this.selectRelease(releases);
      this.release = release;
      this.setState(release ? { phase: "available", release } : { phase: "idle" });
      this.opts.logger.log("info", "update.checked", { version: release?.version ?? null });
    } catch (err) {
      const code = err instanceof UpdateProblem ? err.code : "update.check_failed";
      this.opts.logger.log("warn", "update.check_failed", { code, error: messageOf(err) });
      if (reportFailure) this.fail("check", code);
      else this.setState(this.release ? { phase: "available", release: this.release } : { phase: "idle" });
    } finally {
      this.checkedAtMs = this.now();
      this.checkedAt = new Date(this.checkedAtMs).toISOString();
    }
    return this.status();
  }

  /** Start downloading the available installer. Repeated calls share one download. */
  startDownload(): AppUpdateResponse {
    if (this.downloadTask) return this.status();
    const release =
      this.state.phase === "available"
        ? this.state.release
        : this.state.phase === "error"
          ? this.state.release
          : undefined;
    if (!release) {
      this.fail("download", "update.not_available");
      return this.status();
    }
    if (!this.opts.fetchImpl) {
      this.fail("download", "update.offline", release);
      return this.status();
    }
    const controller = new AbortController();
    this.controller = controller;
    this.setState({ phase: "downloading", release, received: 0, total: release.asset.size });
    this.downloadTask = this.download(release, controller.signal).finally(() => {
      this.downloadTask = null;
      this.controller = null;
    });
    return this.status();
  }

  /** Settles when the current download attempt ends; used by tests and shutdown. */
  async waitForDownload(): Promise<void> {
    await this.downloadTask;
  }

  /** Stop the current download; the release stays available for a retry. */
  cancel(): AppUpdateResponse {
    this.controller?.abort();
    return this.status();
  }

  /** Ask the desktop app to open the downloaded installer. */
  async open(): Promise<AppUpdateResponse> {
    const release =
      this.state.phase === "downloaded"
        ? this.state.release
        : this.state.phase === "error" && this.state.operation === "open"
          ? this.state.release
          : undefined;
    if (!release) {
      this.fail("open", "update.not_available");
      return this.status();
    }
    const file = path.join(this.opts.dir, release.version, release.asset.name);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size !== release.asset.size) {
      this.fail("open", "update.open_failed", release);
      return this.status();
    }
    try {
      if (fs.readFileSync(`${file}.sha256`, "utf8").trim() !== release.asset.sha256) {
        this.fail("open", "update.open_failed", release);
        return this.status();
      }
    } catch {
      this.fail("open", "update.open_failed", release);
      return this.status();
    }
    if (!this.opts.openInstaller) {
      this.fail("open", "update.desktop_only", release);
      return this.status();
    }
    try {
      const error = await this.opts.openInstaller(file);
      if (error) {
        this.opts.logger.log("warn", "update.open_failed", { error });
        this.fail("open", "update.open_failed", release);
      } else {
        this.opts.logger.log("info", "update.open", { version: release.version, file: release.asset.name });
      }
    } catch (err) {
      this.opts.logger.log("warn", "update.open_failed", { error: messageOf(err) });
      this.fail("open", "update.open_failed", release);
    }
    return this.status();
  }

  private async fetchReleases(): Promise<GitHubRelease[]> {
    const res = await this.fetchWithTimeout(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `BukitJalil/${this.opts.currentVersion}` },
    });
    if (!res.ok) throw new UpdateProblem("update.check_failed");
    const json: unknown = await res.json();
    if (!Array.isArray(json)) throw new UpdateProblem("update.check_failed");
    return json as GitHubRelease[];
  }

  private async selectRelease(releases: GitHubRelease[]): Promise<AppUpdateRelease | null> {
    const current = semver.valid(this.opts.currentVersion);
    if (!current) throw new UpdateProblem("update.check_failed");
    const allowPrerelease = semver.prerelease(current) !== null;
    const candidates: { release: GitHubRelease; version: string }[] = [];
    for (const release of releases) {
      if (release.draft === true || typeof release.tag_name !== "string") continue;
      const version = release.tag_name.replace(/^v/, "");
      if (!semver.valid(version) || !semver.gt(version, current)) continue;
      if (!allowPrerelease && semver.prerelease(version) !== null) continue;
      if (typeof release.html_url !== "string" || !isAllowedPage(release.html_url)) continue;
      candidates.push({ release, version });
    }
    candidates.sort((a, b) => semver.rcompare(a.version, b.version));

    for (const candidate of candidates) {
      const asset = this.pickAsset(candidate.release.assets, candidate.version);
      if (!asset) continue;
      const sha256 = await this.readChecksum(candidate.release.assets, asset.name);
      if (!sha256) throw new UpdateProblem("update.checksum_missing");
      return {
        version: candidate.version,
        publishedAt: typeof candidate.release.published_at === "string" ? candidate.release.published_at : "",
        pageUrl: candidate.release.html_url as string,
        prerelease: candidate.release.prerelease === true,
        asset: { ...asset, sha256 },
      };
    }
    if (candidates.length > 0) throw new UpdateProblem("update.no_asset");
    return null;
  }

  private pickAsset(raw: unknown, version: string): Omit<AppUpdateAsset, "sha256"> | null {
    if (!Array.isArray(raw)) return null;
    const assets = raw.filter((item): item is GitHubAsset => typeof item === "object" && item !== null);
    for (const { pattern, format } of assetPatterns(this.platform, this.arch, this.linuxPackage)) {
      const match = assets.find((asset) => {
        if (typeof asset.name !== "string" || typeof asset.size !== "number") return false;
        if (!Number.isSafeInteger(asset.size) || asset.size < 0) return false;
        if (asset.name === "." || asset.name === ".." || asset.name !== path.basename(asset.name)) return false;
        if (typeof asset.browser_download_url !== "string" || !isAllowedDownload(asset.browser_download_url))
          return false;
        if (assetVersion(asset.name) !== version) return false;
        return pattern.test(asset.name);
      });
      if (match) {
        return {
          name: match.name as string,
          size: match.size as number,
          format,
          url: match.browser_download_url as string,
        };
      }
    }
    return null;
  }

  /** Metadata requests are short; their timer must not keep a shutting-down server alive. */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    timer.unref?.();
    try {
      const res = await this.opts.fetchImpl?.(url, { ...init, signal: controller.signal });
      if (!res) throw new UpdateProblem("update.check_failed");
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  private async readChecksum(raw: unknown, name: string): Promise<string | null> {
    if (!Array.isArray(raw)) return null;
    const sums = raw.find(
      (item): item is GitHubAsset =>
        typeof item === "object" &&
        item !== null &&
        (item as GitHubAsset).name === "SHA256SUMS.txt" &&
        typeof (item as GitHubAsset).browser_download_url === "string",
    );
    if (!sums || !isAllowedDownload(sums.browser_download_url as string)) return null;
    const res = await this.fetchWithTimeout(sums.browser_download_url as string, {
      headers: { "User-Agent": `BukitJalil/${this.opts.currentVersion}` },
    });
    if (res.status === 404) throw new UpdateProblem("update.checksum_missing");
    if (!res.ok) throw new UpdateProblem("update.check_failed");
    assertAllowedUrl(res.url);
    const text = await res.text();
    for (const line of text.split("\n")) {
      const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
      if (match?.[2] === name) return match[1]?.toLowerCase() ?? null;
    }
    return null;
  }

  private async download(release: AppUpdateRelease, signal: AbortSignal): Promise<void> {
    const dir = path.join(this.opts.dir, release.version);
    const file = path.join(dir, release.asset.name);
    const part = `${file}.part`;
    try {
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
      if (await this.validExisting(file, release.asset)) {
        this.setState(
          signal.aborted
            ? { phase: "available", release }
            : { phase: "downloaded", release, fileName: release.asset.name },
        );
        return;
      }
      await fsp.rm(part, { force: true });
      const res = await this.opts.fetchImpl?.(release.asset.url, {
        headers: { "User-Agent": `BukitJalil/${this.opts.currentVersion}` },
        signal,
        redirect: "follow",
      });
      if (!res?.ok || !res.body) throw new UpdateProblem("update.download_failed");
      assertAllowedUrl(res.url);
      const hash = createHash("sha256");
      let received = 0;
      let last = 0;
      const meter = new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
          hash.update(chunk);
          received += chunk.length;
          const now = Date.now();
          if (now - last >= 250) {
            last = now;
            // Progress is polled; updating here keeps memory bounded and avoids a timer per download.
            this.setState({ phase: "downloading", release, received, total: release.asset.size });
          }
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(part, { mode: 0o600 }));
      this.setState({ phase: "verifying", release });
      const actual = hash.digest("hex");
      if (actual !== release.asset.sha256) {
        await fsp.rm(part, { force: true });
        throw new UpdateProblem("update.checksum_mismatch");
      }
      // Windows rename does not replace an existing file; the old installer and its sidecar are obsolete.
      await fsp.rm(file, { force: true });
      await fsp.rm(`${file}.sha256`, { force: true });
      await fsp.rename(part, file);
      if (file.endsWith(".AppImage")) await fsp.chmod(file, 0o755);
      await fsp.writeFile(`${file}.sha256`, `${release.asset.sha256}\n`, { mode: 0o600 });
      this.setState({ phase: "downloaded", release, fileName: release.asset.name });
      this.opts.logger.log("info", "update.downloaded", { version: release.version, file: release.asset.name });
      await this.prune(this.opts.dir, release.version);
    } catch (err) {
      await fsp.rm(part, { force: true }).catch(() => {});
      if (signal.aborted) {
        this.setState({ phase: "available", release });
        return;
      }
      const code = err instanceof UpdateProblem ? err.code : nodeErrorCode(err);
      this.opts.logger.log("warn", "update.download_failed", { code, error: messageOf(err) });
      this.fail("download", code, release);
    }
  }

  private async pruneInstalled(): Promise<void> {
    const current = semver.valid(this.opts.currentVersion);
    try {
      for (const entry of await fsp.readdir(this.opts.dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(this.opts.dir, entry.name);
        const files = await fsp.readdir(dir).catch(() => [] as string[]);
        for (const file of files) {
          if (file.endsWith(".part")) await fsp.rm(path.join(dir, file), { force: true });
        }
        const obsolete = current !== null && semver.valid(entry.name) && semver.lte(entry.name, current);
        if (obsolete || files.every((file) => file.endsWith(".part"))) {
          await fsp.rm(dir, { recursive: true, force: true });
        }
      }
    } catch {
      // No updates folder yet, or it is not readable; the next download handles it.
    }
  }

  /** Keep only the newest downloaded version; a failed or part file is removed by the next attempt. */
  private async prune(root: string, keep: string): Promise<void> {
    try {
      for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== keep) {
          await fsp.rm(path.join(root, entry.name), { recursive: true, force: true });
        }
      }
    } catch {
      // Cleanup is best effort; the current installer is already ready.
    }
  }

  private async validExisting(file: string, asset: AppUpdateAsset): Promise<boolean> {
    try {
      const stat = await fsp.lstat(file);
      if (!stat.isFile() || stat.size !== asset.size) return false;
      const recorded = (await fsp.readFile(`${file}.sha256`, "utf8")).trim();
      if (recorded !== asset.sha256) return false;
      if (asset.format === "appimage") await fsp.chmod(file, 0o755);
      return true;
    } catch {
      return false;
    }
  }

  private fail(operation: "check" | "download" | "open", code: ErrorCode, release?: AppUpdateRelease): void {
    this.setState({ phase: "error", operation, code, ...(release ? { release } : {}) });
  }

  private setState(state: AppUpdateState): void {
    this.state = state;
  }

  private get platform(): NodeJS.Platform {
    return this.opts.platform ?? process.platform;
  }

  private get arch(): string {
    return this.opts.arch ?? process.arch;
  }

  private get linuxPackage(): "appimage" | "deb" {
    return this.opts.linuxPackage ?? (process.env.APPIMAGE ? "appimage" : "deb");
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }
}

const ASSET_NAME =
  /^BukitJalil-(.+)-(?:mac-arm64|mac-x64|win-x64|linux-x86_64|linux-amd64|linux-arm64)\.(?:dmg|zip|exe|AppImage|deb)$/;

/** The exact version segment of `BukitJalil-<version>-<platform>.<ext>`. */
function assetVersion(name: string): string | null {
  return ASSET_NAME.exec(name)?.[1] ?? null;
}

/** electron-builder names Linux x64 packages x86_64 (AppImage) and amd64 (deb); arm64 is arm64 in both. */
const LINUX_ARCH: Record<string, { appimage: string; deb: string } | undefined> = {
  x64: { appimage: "x86_64", deb: "amd64" },
  arm64: { appimage: "arm64", deb: "arm64" },
};

function assetPatterns(
  platform: NodeJS.Platform,
  arch: string,
  linuxPackage: "appimage" | "deb",
): { pattern: RegExp; format: AppUpdateFormat }[] {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return [
      { pattern: new RegExp(`-mac-${arch}\\.dmg$`), format: "dmg" },
      { pattern: new RegExp(`-mac-${arch}\\.zip$`), format: "zip" },
    ];
  }
  if (platform === "win32" && arch === "x64") return [{ pattern: /-win-x64\.exe$/, format: "exe" }];
  const linux = LINUX_ARCH[arch];
  if (platform === "linux" && linux) {
    const appimage = { pattern: new RegExp(`-linux-${linux.appimage}\\.AppImage$`), format: "appimage" } as const;
    const deb = { pattern: new RegExp(`-linux-${linux.deb}\\.deb$`), format: "deb" } as const;
    return linuxPackage === "appimage" ? [appimage, deb] : [deb, appimage];
  }
  return [];
}

function isAllowedPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  } catch {
    return false;
  }
}

function isAllowedDownload(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && GITHUB_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function assertAllowedUrl(value: string): void {
  if (value !== "" && !isAllowedDownload(value)) throw new UpdateProblem("update.download_failed");
}

function nodeErrorCode(err: unknown): ErrorCode {
  for (const candidate of [err, (err as { cause?: unknown } | null)?.cause]) {
    const code = (candidate as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOSPC") return "fs.disk_full";
    if (code === "EACCES" || code === "EPERM") return "fs.permission_denied";
  }
  return "update.download_failed";
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
