import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { GitRunner } from "../git/run.ts";
import type { BukitService } from "./locate.ts";

/**
 * Bukit child processes (plan 8.2): argument array, no shell, explicit minimal environment.
 * - PATH is a private directory holding only a `git` link, then /usr/bin:/bin, so Bukit never finds sass /
 *   magick from Homebrew, MacPorts or /usr/local/bin (git's own directory may hold them too)
 * - git hardening reaches the git that Bukit starts itself through GIT_CONFIG_* (plan 7.3)
 * - TMPDIR is the app's own directory (Bukit puts i18n worktrees, leases and locks there)
 * - secrets are only passed when the caller adds them explicitly (plan 8.5)
 */

export type BukitCommand = "version" | "check" | "doctor" | "build" | "schema";

export const DEFAULT_TIMEOUTS: Record<BukitCommand, number> = {
  version: 15_000,
  check: 60_000,
  doctor: 60_000,
  schema: 60_000,
  build: 5 * 60_000,
};

/** The only variables a caller may add; everything else in the environment is fixed here. */
export interface BukitSecrets {
  NOTION_TOKEN?: string;
  GITHUB_TOKEN?: string;
}
const SECRET_KEYS = ["NOTION_TOKEN", "GITHUB_TOKEN"] as const;

export interface BukitRunOptions {
  cwd: string;
  /** Secrets for a user-triggered main build or deploy (plan 8.5). Never for unreviewed content. */
  env?: BukitSecrets;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface BukitRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Stopped by timeout or abort (after SIGINT, then SIGKILL if needed). */
  stopped: "timeout" | "aborted" | null;
}

/** Characters kept of each stream: the start and, in a rolling window, the end (errors come last). */
const CAPTURE_HEAD = 1024 * 1024;
const CAPTURE_TAIL = 3 * 1024 * 1024;
export const CAPTURE_GAP = "[... output in the middle left out ...]";

/**
 * Text of a stream capped at head + tail characters. Bukit 2.0.x logs everything to stderr, one line per
 * SEO issue, so a large build easily passes the cap; keeping only the start would drop the error that made
 * it fail. The tail starts at a line boundary, so no JSON log line is cut in half.
 */
export class StreamCapture {
  private head = "";
  private tail = "";
  /** The head is full: further text goes to the tail. */
  private full = false;
  /** The tail was trimmed: something between head and tail is gone. */
  private omitted = false;

  constructor(
    private readonly headMax = CAPTURE_HEAD,
    private readonly tailMax = CAPTURE_TAIL,
  ) {}

  push(chunk: string): void {
    if (this.full) {
      this.tail += chunk;
      if (this.tail.length > this.tailMax * 2) this.trim();
      return;
    }
    if (this.head.length + chunk.length <= this.headMax) {
      this.head += chunk;
      return;
    }
    // The head keeps whole lines only; the line that does not fit, partly in the head so far, starts the tail.
    const all = this.head + chunk;
    const cut = all.lastIndexOf("\n", this.headMax - 1);
    this.head = all.slice(0, cut + 1);
    this.tail = all.slice(cut + 1);
    this.full = true;
    if (this.tail.length > this.tailMax * 2) this.trim();
  }

  text(): string {
    this.trim();
    if (!this.omitted) return this.head + this.tail;
    return `${this.head}${CAPTURE_GAP}\n${this.tail}`;
  }

  private trim(): void {
    if (this.tail.length <= this.tailMax) return;
    const start = this.tail.length - this.tailMax;
    // Start at a line boundary: right here if a line begins at `start`, else after the next newline.
    const nl = this.tail[start - 1] === "\n" ? start - 1 : this.tail.indexOf("\n", start);
    this.tail = nl >= 0 ? this.tail.slice(nl + 1) : this.tail.slice(start);
    this.omitted = true;
  }
}
const KILL_GRACE_MS = 10_000;

export class BukitRunner {
  constructor(private readonly opts: { bukitPath: string; git: GitRunner; home: string; tmpDir: string }) {}

  /** Directory with a single `git` symlink to the resolved git; first on Bukit's PATH. */
  get binDir(): string {
    return path.join(this.opts.home, "bukit-path");
  }

  /** Create or repair the private PATH directory: exactly one entry, `git` -> the resolved git path. */
  private ensureBinDir(): void {
    const dir = this.binDir;
    const link = path.join(dir, "git");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    let current: string | null = null;
    try {
      current = fs.readlinkSync(link);
    } catch {
      // missing or not a link
    }
    const stray = fs.readdirSync(dir).filter((n) => n !== "git");
    if (current === this.opts.git.opts.gitPath && stray.length === 0) return;
    for (const name of [...stray, "git"]) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    fs.symlinkSync(this.opts.git.opts.gitPath, link);
  }

  env(secrets: BukitSecrets = {}): Record<string, string> {
    fs.mkdirSync(this.opts.tmpDir, { recursive: true, mode: 0o700 });
    this.ensureBinDir();
    const env: Record<string, string> = {};
    for (const key of SECRET_KEYS) {
      const value = secrets[key];
      if (typeof value === "string") env[key] = value;
    }
    return {
      ...env,
      PATH: [this.binDir, "/usr/bin", "/bin"].join(path.delimiter),
      HOME: this.opts.home,
      LANG: "C.UTF-8",
      TMPDIR: this.opts.tmpDir,
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      ...this.opts.git.envForChildGit(),
    };
  }

  run(command: BukitCommand, args: readonly string[], opts: BukitRunOptions): Promise<BukitRunResult> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.bukitPath, args, {
        cwd: opts.cwd,
        env: this.env(opts.env),
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      const stdout = new StreamCapture();
      const stderr = new StreamCapture();
      let stopped: BukitRunResult["stopped"] = null;
      let killTimer: NodeJS.Timeout | undefined;

      // SIGINT first: since 2.0.11 `build` cancels and rolls back; force-kill if it does not exit in time.
      const stop = (why: "timeout" | "aborted") => {
        if (stopped) return;
        stopped = why;
        child.kill("SIGINT");
        killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      };
      const timer = setTimeout(() => stop("timeout"), opts.timeoutMs ?? DEFAULT_TIMEOUTS[command]);
      const onAbort = () => stop("aborted");
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts.signal?.aborted) onAbort();

      // Decode as streams so multibyte characters split across chunks stay intact.
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (d: string) => stdout.push(d));
      child.stderr.on("data", (d: string) => stderr.push(d));
      child.on("error", (err) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        opts.signal?.removeEventListener("abort", onAbort);
        reject(new Error(`cannot run bukit: ${err.message}`));
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        opts.signal?.removeEventListener("abort", onAbort);
        resolve({
          exitCode: code ?? (signal ? 128 : -1),
          stdout: stdout.text(),
          stderr: stderr.text(),
          durationMs: Date.now() - started,
          stopped,
        });
      });
    });
  }
}

/** A runner for the located Bukit, or null when there is none or its version is not supported. */
export async function usableRunner(
  bukit: BukitService,
  opts: { git: GitRunner; home: string; tmpDir: string },
): Promise<BukitRunner | null> {
  const status = await bukit.status();
  if (!status.path || (status.state !== "ok" && status.state !== "old")) return null;
  return new BukitRunner({ bukitPath: status.path, ...opts });
}

// --- exit codes, interpreted per command (plan 8.2; measured in M1) ---

/** config check / doctor: anything but 0 means "check failed"; the output explains why. */
export function checkPassed(result: BukitRunResult): boolean {
  return result.stopped === null && result.exitCode === 0;
}

export type BuildOutcome = "ok" | "config_or_content_error" | "render_error" | "stopped" | "failed";

/** build: 0 success, 2 config or content error, 3 render error, anything else a run failure. */
export function buildOutcome(result: BukitRunResult): BuildOutcome {
  if (result.stopped) return "stopped";
  switch (result.exitCode) {
    case 0:
      return "ok";
    case 2:
      return "config_or_content_error";
    case 3:
      return "render_error";
    default:
      return "failed";
  }
}

/** "bukit 2.0.11+9006a2b…" -> "2.0.11" */
export function parseBukitVersion(output: string): string | null {
  return /^bukit\s+(\d+\.\d+\.\d+)/m.exec(output)?.[1] ?? null;
}

/** `--log-format json` lines from build: [{ts, level, msg}], ignoring anything that is not JSON. */
export function parseJsonLog(stdout: string): { level: string; msg: string }[] {
  return stdout.split("\n").flatMap((line) => logEntry(line) ?? []);
}

/** One `--log-format json` line, or null for anything else (text, the cli-error document, blank lines). */
export function logEntry(line: string): { level: string; msg: string } | null {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  try {
    const v = JSON.parse(t) as { level?: unknown; msg?: unknown };
    return typeof v.level === "string" && typeof v.msg === "string" ? { level: v.level, msg: v.msg } : null;
  } catch {
    return null;
  }
}
