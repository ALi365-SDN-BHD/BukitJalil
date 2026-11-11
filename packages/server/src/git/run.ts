import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkRepoConfig, type RepoCheck } from "./repo-check.ts";

/**
 * The only way BukitJalil runs git (plan 7.3). Every call:
 * - runs the absolute git path resolved once at startup, with an argument array and no shell
 * - adds the fixed hardening flags (no fsmonitor, empty hooks dir, no attribute/ignore files from the
 *   user, no transports, no signing)
 * - gets an explicit minimal environment: no system or global config, HOME is the app data directory,
 *   nothing inherited from the server process (model keys, tokens, GIT_* variables)
 * - inside a repository, first checks the repository's own config against the allowlist (repo-check.ts)
 * - caps the output it collects and fails instead of truncating
 */

export interface GitRunnerOptions {
  /** Absolute path of the git executable (resolveGitPath). */
  gitPath: string;
  /** App data directory; used as HOME so nothing in the user's home is read. */
  home: string;
  /** Empty file used as global config, attributes file and excludes file. */
  emptyFile: string;
  /** Empty directory used as core.hooksPath. */
  hooksDir: string;
  /**
   * GIT_CEILING_DIRECTORIES: git never looks for a repository at or above these. The app data directory
   * goes here, so a broken checkout under worktrees/ cannot make git find a repository in the user's home.
   */
  ceilingDirs?: string[];
}

export interface RunOptions {
  cwd: string;
  /**
   * Check the repository config before running (default true). Off only for calls that are not about an
   * existing repository's content: `init`, `check-ref-format`, `--version`, and the config check itself.
   */
  repoCheck?: boolean;
  /** Extra `-c key=value` pairs, e.g. the commit identity. Keys are fixed strings from our code. */
  config?: Record<string, string>;
  input?: string | Buffer;
  /** Collected stdout limit; exceeding it is an error (default 16 MiB). */
  maxOutputBytes?: number;
  /** Keep only the first N bytes of stdout and drop the rest without error (reading a file's head). */
  headBytes?: number;
  timeoutMs?: number;
  /** Exit codes treated as success besides 0 (e.g. 1 for `diff --quiet`). */
  okCodes?: number[];
  /**
   * Let git look for the repository above `cwd` (default false). Normally git may only use a repository
   * at `cwd` itself: a site whose .git went missing must fail, not fall through to an enclosing repository
   * such as a dotfiles repo in the home folder.
   */
  discover?: boolean;
}

export interface RunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export type GitErrorKind = "failed" | "output_too_large" | "timeout" | "spawn" | "unsafe_repo" | "dubious_ownership";

export class GitError extends Error {
  constructor(
    readonly kind: GitErrorKind,
    message: string,
    readonly details: { code?: number; stderr?: string; reasons?: string[]; max?: number } = {},
  ) {
    super(message);
    this.name = "GitError";
  }
}

const DEFAULT_MAX_OUTPUT = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STDERR = 64 * 1024;

export class GitRunner {
  private readonly checkCache = new Map<string, { stamp: string; result: RepoCheck }>();

  constructor(readonly opts: GitRunnerOptions) {}

  /** Fixed `-c` flags of plan 7.3, before any subcommand. */
  hardeningArgs(): string[] {
    const { emptyFile, hooksDir } = this.opts;
    return [
      "core.fsmonitor=false",
      `core.hooksPath=${hooksDir}`,
      "core.untrackedCache=false",
      `core.attributesFile=${emptyFile}`,
      `core.excludesFile=${emptyFile}`,
      "protocol.allow=never",
      "commit.gpgSign=false",
      "tag.gpgSign=false",
      "log.showSignature=false",
    ].flatMap((kv) => ["-c", kv]);
  }

  /**
   * The environment of every hardened git process. With `cwd`, its parent becomes a ceiling directory too,
   * so git finds only a repository at `cwd` itself (RunOptions.discover).
   */
  env(cwd?: string): Record<string, string> {
    const ceilings = [...(this.opts.ceilingDirs ?? []), ...(cwd ? [path.dirname(path.resolve(cwd))] : [])];
    return {
      PATH: [path.dirname(this.opts.gitPath), "/usr/bin", "/bin"].join(path.delimiter),
      HOME: this.opts.home,
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: this.opts.emptyFile,
      GIT_TERMINAL_PROMPT: "0",
      ...(ceilings.length ? { GIT_CEILING_DIRECTORIES: ceilings.join(path.delimiter) } : {}),
    };
  }

  /** Same hardening for git processes that Bukit starts itself (plan 7.3, 8.2): GIT_CONFIG_COUNT etc. */
  envForChildGit(): Record<string, string> {
    const env: Record<string, string> = {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: this.opts.emptyFile,
      GIT_TERMINAL_PROMPT: "0",
    };
    const pairs = this.hardeningArgs().filter((_, i) => i % 2 === 1);
    env.GIT_CONFIG_COUNT = String(pairs.length);
    pairs.forEach((kv, i) => {
      const eq = kv.indexOf("=");
      env[`GIT_CONFIG_KEY_${i}`] = kv.slice(0, eq);
      env[`GIT_CONFIG_VALUE_${i}`] = kv.slice(eq + 1);
    });
    return env;
  }

  async run(args: readonly string[], opts: RunOptions): Promise<RunResult> {
    if (opts.repoCheck !== false) await this.assertSafeRepo(opts.cwd);
    return this.spawnGit(args, opts);
  }

  /** run() returning stdout as UTF-8 text. */
  async text(args: readonly string[], opts: RunOptions): Promise<string> {
    return (await this.run(args, opts)).stdout.toString("utf8");
  }

  /**
   * Check the repository at `cwd` against the config allowlist (plan 7.3). Cached by the size and mtime
   * of the files that hold repository config, so a changed config is checked again.
   */
  async checkRepo(cwd: string): Promise<RepoCheck> {
    const dirs = await this.gitDirs(cwd);
    const files = [
      path.join(dirs.commonDir, "config"),
      path.join(dirs.gitDir, "config.worktree"),
      path.join(dirs.commonDir, "config.worktree"),
      path.join(dirs.commonDir, "info", "attributes"),
    ];
    const stamp = files.map(statStamp).join("|");
    const key = dirs.gitDir;
    const cached = this.checkCache.get(key);
    if (cached && cached.stamp === stamp) return cached.result;
    const list = await this.spawnGit(["config", "--list", "--show-scope", "--includes", "-z"], { cwd });
    const attributes = readIfExists(path.join(dirs.commonDir, "info", "attributes"));
    const result = checkRepoConfig(list.stdout.toString("utf8"), attributes);
    this.checkCache.set(key, { stamp, result });
    return result;
  }

  async assertSafeRepo(cwd: string): Promise<void> {
    const result = await this.checkRepo(cwd);
    if (!result.ok) {
      throw new GitError("unsafe_repo", `repository config is not allowed: ${result.reasons.join(", ")}`, {
        reasons: result.reasons,
      });
    }
  }

  private async gitDirs(cwd: string): Promise<{ gitDir: string; commonDir: string }> {
    const out = await this.spawnGit(["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], {
      cwd,
    });
    const [gitDir, commonDir] = out.stdout.toString("utf8").split("\n");
    if (!gitDir || !commonDir) throw new GitError("failed", "cannot locate the git directory");
    return { gitDir, commonDir };
  }

  private spawnGit(args: readonly string[], opts: RunOptions): Promise<RunResult> {
    const extra = Object.entries(opts.config ?? {}).flatMap(([k, v]) => ["-c", `${k}=${v}`]);
    const fullArgs = [...this.hardeningArgs(), ...extra, ...args];
    const maxOutput = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    const okCodes = new Set([0, ...(opts.okCodes ?? [])]);

    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.gitPath, fullArgs, {
        cwd: opts.cwd,
        env: this.env(opts.discover ? undefined : opts.cwd),
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let stderr = "";
      let failure: GitError | null = null;
      const fail = (err: GitError) => {
        if (failure) return;
        failure = err;
        child.kill("SIGKILL");
      };
      const timer = setTimeout(
        () => fail(new GitError("timeout", `git ${args[0]} timed out`)),
        opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );

      child.stdout.on("data", (d: Buffer) => {
        if (opts.headBytes !== undefined) {
          if (size < opts.headBytes) chunks.push(d.subarray(0, opts.headBytes - size));
          size += d.length;
          return;
        }
        size += d.length;
        if (size > maxOutput) {
          fail(
            new GitError("output_too_large", `git ${args[0]} output exceeds ${maxOutput} bytes`, { max: maxOutput }),
          );
          return;
        }
        chunks.push(d);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (d: string) => {
        if (stderr.length < MAX_STDERR) stderr += d;
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new GitError("spawn", `cannot run git: ${err.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failure) return reject(failure);
        const exit = code ?? -1;
        if (!okCodes.has(exit)) {
          const kind: GitErrorKind = /dubious ownership/i.test(stderr) ? "dubious_ownership" : "failed";
          return reject(
            new GitError(kind, `git ${args[0]} exited with ${exit}: ${stderr.trim().slice(0, 500)}`, {
              code: exit,
              stderr,
            }),
          );
        }
        resolve({ code: exit, stdout: Buffer.concat(chunks), stderr });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(opts.input ?? undefined);
    });
  }
}

function statStamp(file: string): string {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return "-";
  }
}

function readIfExists(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * Remove the index lock a killed git command may leave behind. The caller holds the site lock, so no other
 * BukitJalil operation can be using this checkout. Best effort: a failure to find git must not mask the timeout.
 */
export async function clearIndexLock(git: GitRunner, cwd: string): Promise<void> {
  try {
    const pathInRepo = (await git.text(["rev-parse", "--git-path", "index.lock"], { cwd, repoCheck: false })).trim();
    if (pathInRepo !== "") fs.rmSync(path.resolve(cwd, pathInRepo), { force: true });
  } catch {
    // The timeout is the error the caller needs.
  }
}

/** Find `git` on PATH once at startup and return its real absolute path (plan 7.3). */
export function resolveGitPath(envPath = process.env.PATH ?? ""): string | null {
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, process.platform === "win32" ? "git.exe" : "git");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
    } catch {
      // not here
    }
  }
  return null;
}

// --- argument validation (plan 7.3): values from outside never become git options ---

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function isOid(value: string): boolean {
  return OID.test(value);
}

export function assertOid(value: string): string {
  if (!isOid(value)) throw new GitError("failed", "not a full object id");
  return value;
}

/** Branch names are checked by git itself; leading "-" is rejected before git ever sees the value. */
export async function isValidBranchName(git: GitRunner, name: string, cwd: string): Promise<boolean> {
  // "@{-1}" is check-ref-format's "previous branch" syntax, never a branch we accept.
  if (name.length === 0 || name.startsWith("-") || name.includes("@{") || name.length > 255) return false;
  try {
    await git.run(["check-ref-format", "--branch", name], { cwd, repoCheck: false });
    return true;
  } catch {
    return false;
  }
}
