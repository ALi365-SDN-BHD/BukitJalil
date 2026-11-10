import fs from "node:fs";
import path from "node:path";
import { BUILD_DIRS } from "../sites/exclude.ts";

/** A refused file operation; Pi returns the message to the model as the tool's error. */
export class GateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateError";
  }
}

/** Largest file the AI may write (plan 6.3). */
export const MAX_WRITE_BYTES = 1024 * 1024;

/** Top-level directories the AI may not write: build output and caches (plan 6.3). */
const NO_WRITE_TOP = new Set<string>([...BUILD_DIRS, "plugins"]);
/** File names the AI may not write anywhere: plugin manifests (plan 8.5). */
const NO_WRITE_NAMES = new Set(["plugin.yaml", "plugin.json"]);

/**
 * - read: a file in the working copy, or in a read-only root (skills)
 * - list: a directory listed or searched (ls, grep, find); working copy only
 * - write: a file or directory written in the working copy, outside the protected paths
 */
export type GateMode = "read" | "list" | "write";

const within = (p: string, base: string) => p === base || p.startsWith(base + path.sep);
/**
 * A path segment as the file system may store it: lower case (macOS and Windows ignore case), without
 * an NTFS stream suffix (".git::$INDEX_ALLOCATION") or the trailing dots and spaces Windows drops
 * (".git." is .git). Applied on every platform, so the rules do not depend on where the server runs.
 */
export const segmentKey = (name: string) =>
  name
    .toLowerCase()
    .split(":")[0]
    ?.replace(/[. ]+$/, "") ?? "";
const isGitName = (name: string) => segmentKey(name) === ".git";

/** Something exists at `p` itself (a dangling symlink, when realpath has just failed on it). */
function isEntry(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Real path of an absolute path: the deepest existing ancestor through realpath.native (the real case
 * on macOS), then the missing rest appended, so new files and directories resolve too.
 */
function realPathOf(abs: string): string {
  const missing: string[] = [];
  let current = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing.reverse());
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw new GateError(`Cannot resolve ${abs}`);
      // realpath fails on a dangling symlink too; writing through it would land wherever it points.
      if (isEntry(current)) throw new GateError(`Path not allowed: ${abs} goes through a broken symbolic link`);
      const parent = path.dirname(current);
      if (parent === current) throw new GateError(`Cannot resolve ${abs}`);
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * The permission gate (plan 6.3). Pi's tools call it with the final absolute path, after their own path
 * rewriting (`@`, `~`, `file://`, Unicode spaces, NFD variants), so the check holds whatever the model
 * wrote. Every path must resolve inside the working copy; skills are the one read-only exception.
 */
export class PathGate {
  readonly root: string;
  private readonly readOnlyRoots: string[];

  constructor(root: string, readOnlyRoots: readonly string[] = []) {
    this.root = fs.realpathSync.native(root);
    this.readOnlyRoots = readOnlyRoots.map((r) => fs.realpathSync.native(r));
  }

  /** The real path to use for `abs`, or a GateError. */
  check(abs: string, mode: GateMode): string {
    if (typeof abs !== "string" || !path.isAbsolute(abs) || abs.includes("\0")) {
      throw new GateError(`Path not allowed: ${String(abs)}`);
    }
    const real = realPathOf(path.resolve(abs));
    if (!within(real, this.root)) {
      if (mode === "read" && this.readOnlyRoots.some((r) => within(real, r))) return real;
      throw new GateError(`Path not allowed: ${abs} is outside the site's working copy`);
    }
    const parts = path.relative(this.root, real).split(path.sep).filter(Boolean);
    if (parts.some(isGitName)) throw new GateError(`Path not allowed: .git is off limits (${abs})`);
    if (mode === "write") {
      const keys = parts.map(segmentKey);
      const top = keys[0];
      const name = keys.at(-1) ?? "";
      if (
        (top !== undefined && NO_WRITE_TOP.has(top)) ||
        keys.includes("node_modules") ||
        NO_WRITE_NAMES.has(name) ||
        name.startsWith(".env")
      ) {
        throw new GateError(`Path not allowed: ${parts.join("/")} is protected and cannot be written`);
      }
    }
    return real;
  }

  /** Content the AI may write: at most 1 MB of text. */
  checkContent(content: string): void {
    if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
      throw new GateError(`File too large: the limit is ${MAX_WRITE_BYTES} bytes`);
    }
    if (content.includes("\0")) throw new GateError("Binary content cannot be written");
  }
}

/** Write a file the gate has checked, without following a symlink in its last segment (where supported). */
export async function writeChecked(real: string, content: string): Promise<void> {
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW = 0 } = fs.constants;
  const handle = await fs.promises.open(real, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0o644);
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
}
