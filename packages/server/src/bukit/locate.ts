import fs from "node:fs";
import path from "node:path";
import type { BukitStatus } from "@bukitjalil/shared";
import { versionAtLeast } from "../git/version.ts";
import { runProbe } from "../probe.ts";
import {
  BUKIT_VERSION,
  type BukitRelease,
  download,
  FALLBACK_RELEASE,
  fetchLatestRelease,
  InstallError,
  InstallJob,
  installFiles,
  MIN_BUKIT_VERSION,
  PREVIOUS_APP_VERSIONS,
  packageForPlatform,
  RELEASE_CACHE_MS,
  readStrictTarGz,
  readStrictZip,
  verifySha256,
} from "./install.ts";
import { parseBukitVersion } from "./runner.ts";

/**
 * Where Bukit comes from (plan 8.1): only the copies BukitJalil itself installed, newest first, in
 * ~/.bukitjalil/bin/bukit-<version>/ (including earlier app versions).
 */

export const appBukitDir = (home: string, version: string = BUKIT_VERSION) =>
  path.join(home, "bin", `bukit-${version}`);

/** The executable name inside an app-managed package. */
export const BUKIT_EXE = process.platform === "win32" ? "bukit.exe" : "bukit";

function executableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** `bukit version` with a minimal environment; null if it cannot run or prints no version. */
export async function probeBukitVersion(bukitPath: string, tmpDir: string): Promise<string | null> {
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const result = await runProbe(bukitPath, ["version"], {
    PATH: "/usr/bin:/bin",
    LANG: "C.UTF-8",
    TMPDIR: tmpDir,
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  });
  return result.ok ? parseBukitVersion(result.stdout) : null;
}

export function versionState(version: string): "ok" | "old" | "unsupported" {
  if (!version.startsWith("2.0.")) return "unsupported";
  return versionAtLeast(version, MIN_BUKIT_VERSION) ? "ok" : "old";
}

export async function locateBukit(opts: {
  home: string;
  tmpDir: string;
  latestVersion?: string;
  installable?: boolean;
}): Promise<BukitStatus> {
  const latestVersion = opts.latestVersion ?? BUKIT_VERSION;
  const installable = opts.installable ?? packageForPlatform() !== null;
  const appVersions = [...new Set([latestVersion, BUKIT_VERSION, ...PREVIOUS_APP_VERSIONS])];

  let broken: string | null = null;
  for (const version of appVersions) {
    const file = path.join(appBukitDir(opts.home, version), BUKIT_EXE);
    if (!executableFile(file)) continue;
    const found = await probeBukitVersion(file, opts.tmpDir);
    if (found) {
      const state = versionState(found);
      // An older working copy may be replaced by the latest release; a newer one is never "upgraded" down.
      const upgradable = installable && state === "ok" && !versionAtLeast(found, latestVersion);
      return { path: file, version: found, latestVersion, state, installable, upgradable };
    }
    broken ??= file;
  }
  if (broken) return { path: broken, version: null, latestVersion, state: "broken", installable, upgradable: false };
  return { path: null, version: null, latestVersion, state: "missing", installable, upgradable: false };
}

// --- install job, polled through GET /api/bukit ---

/** Download, verify and install the latest official Bukit package for this platform. */
export function bukitInstaller(opts: {
  home: string;
  tmpDir: string;
  fetchImpl?: typeof fetch;
  platform?: string;
  arch?: string;
  /** Latest release lookup; defaults to the built-in fallback so tests and offline use never hit the network. */
  release?: () => Promise<BukitRelease>;
}): InstallJob {
  return new InstallJob(async (report) => {
    const release = await (opts.release ?? (() => Promise.resolve(FALLBACK_RELEASE)))();
    const key = `${opts.platform ?? process.platform}-${opts.arch ?? process.arch}`;
    const asset = release.assets[key];
    if (!asset) throw new InstallError("unsupported_platform", "no official Bukit package for this platform");
    const data = await download(
      asset.url,
      (received, total) => report({ state: "downloading", received, total }),
      opts.fetchImpl,
    );
    report({ state: "verifying" });
    verifySha256(data, asset.sha256);
    const files = asset.file.endsWith(".zip") ? readStrictZip(data, asset.files) : readStrictTarGz(data, asset.files);
    const target = appBukitDir(opts.home, release.version);
    installFiles(files, target, asset.executable);
    const version = await probeBukitVersion(path.join(target, asset.executable), opts.tmpDir);
    if (version !== release.version) {
      fs.rmSync(target, { recursive: true, force: true });
      throw new InstallError("verify_failed", `bukit version printed ${version ?? "nothing"}`);
    }
    // The upgrade replaces every earlier app install, without touching the new one.
    const parent = path.dirname(target);
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      const dir = path.join(parent, entry.name);
      if (entry.isDirectory() && entry.name.startsWith("bukit-") && dir !== target)
        fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

/**
 * Bukit status for the API: located once and cached, because the UI polls during an install and each
 * probe starts a process. The latest release is cached separately for ten minutes; the settings page
 * asks for a fresh status when it opens, and its manual button also refreshes the release.
 */
export class BukitService {
  readonly installer: InstallJob;
  private cached: Promise<BukitStatus> | null = null;
  private release: Promise<BukitRelease> | null = null;
  private releaseAt = 0;

  constructor(
    private readonly opts: {
      home: string;
      tmpDir: string;
      /** Omitted by tests and offline callers: the built-in fallback release is used. */
      fetchImpl?: typeof fetch;
    },
  ) {
    this.installer = bukitInstaller({
      home: opts.home,
      tmpDir: opts.tmpDir,
      fetchImpl: opts.fetchImpl,
      release: () => this.latestRelease(),
    });
  }

  latestRelease(force = false): Promise<BukitRelease> {
    if (!this.opts.fetchImpl) return Promise.resolve(FALLBACK_RELEASE);
    if (force || !this.release || Date.now() - this.releaseAt > RELEASE_CACHE_MS) {
      this.releaseAt = Date.now();
      this.release = fetchLatestRelease(this.opts.fetchImpl);
    }
    return this.release;
  }

  status(): Promise<BukitStatus> {
    if (!this.cached) {
      const located = (async () => {
        const release = await this.latestRelease();
        return locateBukit({
          home: this.opts.home,
          tmpDir: this.opts.tmpDir,
          latestVersion: release.version,
          installable: release.assets[`${process.platform}-${process.arch}`] !== undefined,
        });
      })();
      this.cached = located;
      // A failed lookup is not cached: the next request tries again.
      located.catch(() => {
        if (this.cached === located) this.cached = null;
      });
    }
    return this.cached;
  }

  /** Drop the located status; `forceRelease` also makes the next check ask GitHub again. */
  invalidate(forceRelease = false): void {
    this.cached = null;
    if (forceRelease) {
      this.release = null;
      this.releaseAt = 0;
    }
  }

  install(): boolean {
    const started = this.installer.start();
    if (started) void this.installer.wait().then(() => this.invalidate());
    return started;
  }
}
