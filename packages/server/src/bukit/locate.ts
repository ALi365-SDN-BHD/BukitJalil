import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { BukitInstallProgress, BukitSource, BukitStatus } from "@bukitjalil/shared";
import { versionAtLeast } from "../git/version.ts";
import {
  BUKIT_VERSION,
  download,
  InstallError,
  installFiles,
  packageForPlatform,
  packageUrl,
  readStrictTarGz,
  verifySha256,
} from "./install.ts";
import { parseBukitVersion } from "./runner.ts";

/**
 * Where Bukit comes from (plan 8.1): the custom path from settings, then the app-managed copy in
 * ~/.bukitjalil/bin/bukit-2.0.11/, then `bukit` on the user's PATH.
 */

export const appBukitDir = (home: string) => path.join(home, "bin", `bukit-${BUKIT_VERSION}`);

function executableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function findOnPath(envPath: string): string | null {
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, "bukit");
    if (executableFile(candidate)) return fs.realpathSync(candidate);
  }
  return null;
}

/** `bukit version` with a minimal environment; null if it cannot run or prints no version. */
export function probeBukitVersion(bukitPath: string, tmpDir: string): Promise<string | null> {
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(bukitPath, ["version"], {
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", TMPDIR: tmpDir, DOTNET_CLI_TELEMETRY_OPTOUT: "1" },
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      if (out.length < 64 * 1024) out += d;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? parseBukitVersion(out) : null);
    });
  });
}

export function versionState(version: string): "ok" | "old" | "unsupported" {
  if (!version.startsWith("2.0.")) return "unsupported";
  return versionAtLeast(version, BUKIT_VERSION) ? "ok" : "old";
}

export async function locateBukit(opts: {
  customPath: string | null;
  home: string;
  tmpDir: string;
  envPath?: string;
}): Promise<BukitStatus> {
  const installable = packageForPlatform() !== null;
  let customProblem: BukitStatus["customProblem"] = null;
  const candidates: [BukitSource, string | null][] = [
    ["app", path.join(appBukitDir(opts.home), "bukit")],
    ["path", findOnPath(opts.envPath ?? process.env.PATH ?? "")],
  ];

  if (opts.customPath) {
    if (!path.isAbsolute(opts.customPath) || !executableFile(opts.customPath)) {
      customProblem = "not_found";
    } else {
      const version = await probeBukitVersion(opts.customPath, opts.tmpDir);
      if (version)
        return {
          path: opts.customPath,
          source: "custom",
          version,
          state: versionState(version),
          customProblem,
          installable,
        };
      customProblem = "broken";
    }
  }

  let broken: { path: string; source: BukitSource } | null = null;
  for (const [source, file] of candidates) {
    if (!file || !executableFile(file)) continue;
    const version = await probeBukitVersion(file, opts.tmpDir);
    if (version) return { path: file, source, version, state: versionState(version), customProblem, installable };
    broken ??= { path: file, source };
  }
  if (broken) return { ...broken, version: null, state: "broken", customProblem, installable };
  return { path: null, source: null, version: null, state: "missing", customProblem, installable };
}

// --- install job, polled through GET /api/bukit ---

/** One install at a time; progress is read by polling (`progress`). */
export class BukitInstaller {
  progress: BukitInstallProgress = { state: "idle" };
  private running: Promise<void> | null = null;

  constructor(
    private readonly opts: { home: string; tmpDir: string; fetchImpl?: typeof fetch; platform?: string; arch?: string },
  ) {}

  get busy(): boolean {
    return this.running !== null;
  }

  /** Start installing; returns false if an install is already running. */
  start(): boolean {
    if (this.running) return false;
    this.running = this.install().finally(() => {
      this.running = null;
    });
    return true;
  }

  /** Resolves when the current install (if any) has finished. */
  async wait(): Promise<void> {
    await this.running;
  }

  private async install(): Promise<void> {
    const pkg = packageForPlatform(this.opts.platform, this.opts.arch);
    if (!pkg) {
      this.progress = {
        state: "failed",
        code: "unsupported_platform",
        message: "no official Bukit package for this platform",
      };
      return;
    }
    try {
      this.progress = { state: "downloading", received: 0, total: null };
      const data = await download(
        packageUrl(pkg),
        (received, total) => {
          this.progress = { state: "downloading", received, total };
        },
        this.opts.fetchImpl,
      );
      this.progress = { state: "verifying" };
      verifySha256(data, pkg.sha256);
      const files = readStrictTarGz(data, pkg.files);
      const target = appBukitDir(this.opts.home);
      installFiles(files, target, pkg.executable);
      const version = await probeBukitVersion(path.join(target, pkg.executable), this.opts.tmpDir);
      if (version !== BUKIT_VERSION) {
        fs.rmSync(target, { recursive: true, force: true });
        this.progress = {
          state: "failed",
          code: "verify_failed",
          message: `bukit version printed ${version ?? "nothing"}`,
        };
        return;
      }
      this.progress = { state: "done" };
    } catch (err) {
      this.progress =
        err instanceof InstallError
          ? { state: "failed", code: err.code, message: err.message }
          : { state: "failed", code: "install_failed", message: (err as Error).message };
    }
  }
}

/**
 * Bukit status for the API: located once and cached, because the UI polls during an install and each
 * probe starts a process. Call `invalidate()` after the custom path changes; an install does it itself.
 */
export class BukitService {
  readonly installer: BukitInstaller;
  private cached: Promise<BukitStatus> | null = null;

  constructor(
    private readonly opts: {
      home: string;
      tmpDir: string;
      customPath: () => string | null;
      envPath?: string;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.installer = new BukitInstaller({ home: opts.home, tmpDir: opts.tmpDir, fetchImpl: opts.fetchImpl });
  }

  status(): Promise<BukitStatus> {
    if (!this.cached) {
      const located = locateBukit({
        customPath: this.opts.customPath(),
        home: this.opts.home,
        tmpDir: this.opts.tmpDir,
        envPath: this.opts.envPath,
      });
      this.cached = located;
      // A failed lookup is not cached: the next request tries again.
      located.catch(() => {
        if (this.cached === located) this.cached = null;
      });
    }
    return this.cached;
  }

  invalidate(): void {
    this.cached = null;
  }

  install(): boolean {
    const started = this.installer.start();
    if (started) void this.installer.wait().then(() => this.invalidate());
    return started;
  }
}
