import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GitInstallProgress, GitSource, GitStatus } from "@bukitjalil/shared";
import { download, installTree, readZipTree, verifySha256 } from "../bukit/install.ts";
import { brewPrefix, findBrew } from "./brew.ts";
import { appGitPath, detectPackageManager, gitGuide } from "./platform.ts";
import { resolveGitPath } from "./run.ts";
import { checkGit, type GitHealth, versionAtLeast } from "./version.ts";

export const GIT_LATEST_URL = "https://www.kernel.org/pub/software/scm/git/";
export const GIT_LATEST_CACHE_MS = 10 * 60_000;
const BREW_TIMEOUT_MS = 15 * 60_000;

export interface GitServiceOptions {
  /** null in tests and offline mode: the latest release stays unknown. */
  fetchImpl: typeof fetch | null;
  /** Called after a successful install/update so the running GitRunner switches paths. */
  applyPath?: (gitPath: string) => void;
  /** Tests: use this Homebrew (or null); omitted detects it. */
  brew?: string | null;
  /** Tests: platform to generate the guide for. Defaults to process.platform. */
  platform?: string;
  /** Tests: PATH used to detect package managers. */
  envPath?: string;
  /** Tests: override the detected package manager. */
  manager?: string | null;
  /** App data directory; app-managed Git (Windows) lives under git/current. */
  appHome?: string;
  /** Tests: target architecture for Git for Windows. */
  arch?: string;
  /** Tests: replace the long-running brew process. */
  runBrew?: (brew: string, args: string[]) => Promise<{ code: number; output: string }>;
  /** Tests: resolve the Git path. Defaults to resolveGitPath. */
  resolvePath?: () => string | null;
  /** Tests: check a Git path. Defaults to checkGit. */
  check?: (gitPath: string) => Promise<GitHealth>;
  now?: () => number;
}

/**
 * Git is a system tool, but Homebrew is a user-level package manager: when it is installed the app can
 * install or update Git without admin rights. The service checks both the local/global Git and Homebrew's
 * latest formula, and reports whether an update is available.
 */
export class GitService {
  private readonly brew: string | null;
  private readonly platform: string;
  private readonly manager: string | null;
  private readonly arch: string;
  private progress: GitInstallProgress = { state: "idle" };
  private current: Promise<void> | null = null;
  private latest: Promise<string | null> | null = null;
  private latestAt = 0;

  constructor(private readonly opts: GitServiceOptions) {
    this.platform = opts.platform ?? process.platform;
    this.arch = opts.arch ?? process.arch;
    const envPath = opts.envPath ?? process.env.PATH ?? "";
    this.brew = opts.brew === undefined ? findBrew(envPath) : opts.brew;
    this.manager = this.brew
      ? "homebrew"
      : opts.manager === undefined
        ? detectPackageManager(this.platform, envPath, false)
        : opts.manager;
  }

  get install(): GitInstallProgress {
    return this.progress;
  }

  async status(refresh = false): Promise<GitStatus> {
    if (refresh) this.invalidate();
    const gitPath = this.resolvePath();
    if (gitPath) this.opts.applyPath?.(gitPath);
    const health = gitPath ? await this.check(gitPath) : { ok: false, version: null, problem: "missing" as const };
    const latestVersion = await this.latestVersion();
    const source = sourceOf(gitPath, this.brew, this.opts.appHome);
    const state = !gitPath ? "missing" : health.version === null ? "broken" : health.ok ? "ok" : "too_old";
    return {
      path: gitPath,
      version: health.version,
      latestVersion,
      source,
      state,
      platform: this.platform,
      packageManager: this.manager,
      guide: gitGuide(this.platform, this.manager),
      installable: this.brew !== null || this.platform === "win32",
      updatable:
        (this.brew !== null || this.platform === "win32") &&
        latestVersion !== null &&
        (health.version === null || !versionAtLeast(health.version, latestVersion)),
    };
  }

  /** Start the platform's install/update: Homebrew, or a Git for Windows download on Windows. */
  start(): boolean {
    if (this.current) return false;
    if (this.brew) {
      const brewGit = path.join(path.dirname(this.brew), "git");
      const args = fs.existsSync(brewGit) ? ["upgrade", "git"] : ["install", "git"];
      this.progress = { state: "running", message: `brew ${args.join(" ")}` };
      this.current = this.run(this.brew, args).finally(() => {
        this.current = null;
      });
      return true;
    }
    if (this.platform !== "win32") return false;
    this.progress = { state: "running", message: "Downloading Git for Windows…" };
    this.current = this.installWindows().finally(() => {
      this.current = null;
    });
    return true;
  }

  /** Wait for the current install (tests). */
  async settled(): Promise<void> {
    await this.current;
  }

  invalidate(): void {
    this.latest = null;
    this.latestAt = 0;
  }

  /** Download the official Git for Windows MinGit zip and install it under the app data directory. */
  private async installWindows(): Promise<void> {
    try {
      if (!this.opts.fetchImpl) throw new Error("offline");
      if (!this.opts.appHome) throw new Error("app data directory is not configured");
      const release = await fetchLatestGitForWindows(this.opts.fetchImpl, this.arch);
      if (!release) throw new Error("could not find a Git for Windows package");
      this.progress = { state: "running", message: `Downloading Git ${release.version}…` };
      const data = await download(
        release.url,
        (received, total) => {
          const percent = total ? ` ${Math.floor((received / total) * 100)}%` : "";
          this.progress = { state: "running", message: `Downloading Git ${release.version}${percent}` };
        },
        this.opts.fetchImpl,
      );
      verifySha256(data, release.sha256);
      const target = path.join(this.opts.appHome, "git", "current");
      installTree(readZipTree(data), target);
      const gitPath = appGitPath(this.opts.appHome, this.platform);
      if (!gitPath) throw new Error("Git for Windows has no git.exe");
      this.opts.applyPath?.(gitPath);
      const health = await this.check(gitPath);
      this.progress = { state: "done", version: health.version };
    } catch (err) {
      this.progress = { state: "failed", message: err instanceof Error ? err.message : String(err) };
    }
  }

  private resolvePath(): string | null {
    if (this.opts.resolvePath) return this.opts.resolvePath();
    return resolveGitPath() ?? (this.opts.appHome ? appGitPath(this.opts.appHome, this.platform) : null);
  }

  private check(gitPath: string): Promise<GitHealth> {
    return this.opts.check ? this.opts.check(gitPath) : checkGit(gitPath);
  }

  private latestVersion(): Promise<string | null> {
    const now = this.opts.now?.() ?? Date.now();
    if (this.latest && now - this.latestAt < GIT_LATEST_CACHE_MS) return this.latest;
    if (!this.opts.fetchImpl) return Promise.resolve(null);
    this.latestAt = now;
    this.latest = fetchLatestGitVersion(this.opts.fetchImpl);
    return this.latest;
  }

  private async run(brew: string, args: string[]): Promise<void> {
    try {
      const result = await (this.opts.runBrew ?? runBrew)(brew, args);
      if (result.code !== 0) {
        this.progress = { state: "failed", message: lastLine(result.output) || `brew exited ${result.code}` };
        return;
      }
      const gitPath = this.resolvePath();
      if (gitPath) this.opts.applyPath?.(gitPath);
      const health = gitPath ? await this.check(gitPath) : null;
      this.progress = { state: "done", version: health?.version ?? null };
    } catch (err) {
      this.progress = { state: "failed", message: err instanceof Error ? err.message : String(err) };
    }
  }
}

export async function fetchLatestGitVersion(fetchImpl: typeof fetch, timeoutMs = 8_000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(GIT_LATEST_URL, {
      headers: { Accept: "text/html", "User-Agent": "BukitJalil" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const html = await res.text();
    const versions = new Set(
      [...html.matchAll(/git-(\d+\.\d+\.\d+)\.tar\.gz/g)].map((match) => match[1] ?? "").filter(Boolean),
    );
    let best: string | null = null;
    for (const version of versions) if (!best || versionAtLeast(version, best)) best = version;
    return best;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The latest official Git for Windows MinGit package for this architecture. */
export async function fetchLatestGitForWindows(
  fetchImpl: typeof fetch,
  arch = "x64",
  timeoutMs = 8_000,
): Promise<{ version: string; url: string; sha256: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl("https://api.github.com/repos/git-for-windows/git/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "BukitJalil" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      tag_name?: string;
      assets?: { name?: string; browser_download_url?: string; digest?: string | null }[];
    };
    const version = /^v?(\d+\.\d+\.\d+)(?:\.windows\.\d+)?$/.exec(json.tag_name ?? "")?.[1];
    if (!version) return null;
    const suffix = arch === "arm64" ? "arm64" : arch === "ia32" ? "32-bit" : "64-bit";
    const asset = json.assets?.find((item) => item.name === `MinGit-${version}-${suffix}.zip`);
    const sha256 = asset?.digest?.startsWith("sha256:") ? asset.digest.slice("sha256:".length) : "";
    if (!asset?.browser_download_url || !/^[0-9a-f]{64}$/.test(sha256)) return null;
    return { version, url: asset.browser_download_url, sha256 };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function sourceOf(gitPath: string | null, brew: string | null, appHome: string | undefined): GitSource {
  if (!gitPath) return null;
  if (appHome && gitPath.startsWith(`${path.join(appHome, "git")}${path.sep}`)) return "app";
  if (brew && gitPath.startsWith(`${brewPrefix(brew)}${path.sep}`)) return "homebrew";
  return gitPath.startsWith("/usr/bin/") ? "system" : "path";
}

function runBrew(brew: string, args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-32 * 1024);
    };
    const child = spawn(brew, args, {
      env: {
        PATH: [path.dirname(brew), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(path.delimiter),
        HOME: os.homedir(),
        USER: os.userInfo().username,
        LANG: "C",
        HOMEBREW_NO_ANALYTICS: "1",
        HOMEBREW_NO_ENV_HINTS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => child.kill("SIGTERM"), BREW_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, output: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}

function lastLine(output: string): string {
  const lines = output
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines[lines.length - 1] ?? "").slice(0, 300);
}
