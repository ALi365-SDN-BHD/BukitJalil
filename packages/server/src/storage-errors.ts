import { GitError } from "./git/run.ts";

/** Disk write failures the UI explains (plan M5 layer 2). */
export type StorageErrorCode = "fs.disk_full" | "fs.read_only" | "fs.permission_denied";

const BY_ERRNO: Record<string, StorageErrorCode> = {
  ENOSPC: "fs.disk_full",
  EDQUOT: "fs.disk_full",
  EROFS: "fs.read_only",
  EACCES: "fs.permission_denied",
  EPERM: "fs.permission_denied",
};

// The same failures as child processes (git, Bukit) print them.
const BY_TEXT: [RegExp, StorageErrorCode][] = [
  [/no space left on device|disk quota exceeded/i, "fs.disk_full"],
  [/read-only file system/i, "fs.read_only"],
];

/**
 * The storage failure behind an error, if it is one: a Node errno (on the error or its causes) or a git
 * error whose stderr names one. Text from other tools goes through `storageErrorInText`.
 */
export function storageErrorCode(err: unknown): StorageErrorCode | null {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    const errno = (e as NodeJS.ErrnoException).code;
    if (typeof errno === "string" && errno in BY_ERRNO) return BY_ERRNO[errno] ?? null;
    if (e instanceof GitError) {
      const found = storageErrorInText(`${e.message}\n${e.details.stderr ?? ""}`);
      if (found) return found;
    }
  }
  return null;
}

/** A disk-full or read-only failure named in a tool's output; permission errors are too vague to tell. */
export function storageErrorInText(text: string): StorageErrorCode | null {
  for (const [pattern, code] of BY_TEXT) if (pattern.test(text)) return code;
  return null;
}
