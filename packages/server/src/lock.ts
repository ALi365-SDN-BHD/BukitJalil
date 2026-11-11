import fs from "node:fs";

/** Another server is using the data directory. */
export class HomeInUseError extends Error {
  constructor(
    readonly file: string,
    readonly pid: number,
  ) {
    super(
      pid > 0
        ? `Another BukitJalil (process ${pid}) is using this data directory. Quit it first, or delete ${file} if it is gone.`
        : `Another BukitJalil is starting with this data directory. Try again in a moment, or delete ${file} if it is gone.`,
    );
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

interface Holder {
  pid: number | null;
  /** The whole `${pid}\n` line is there, so the PID is not a partial write. */
  complete: boolean;
}

function read(file: string): Holder {
  try {
    const text = fs.readFileSync(file, "utf8");
    const pid = Number(text.trim());
    const valid = Number.isInteger(pid) && pid > 0;
    return { pid: valid ? pid : null, complete: valid && text.endsWith("\n") };
  } catch {
    return { pid: null, complete: false };
  }
}

const holder = (file: string): number | null => read(file).pid;

/**
 * A lock file becomes visible as soon as it is opened, before its PID is written. A second process can read
 * it in that tiny window. Treat a fresh but incomplete file as held for this long instead of deleting
 * the first process's lock; a lock from a crashed process can be taken over after this.
 */
const LOCK_WRITE_GRACE_MS = 2_000;

/**
 * Take the data directory for this process (plan M7): the desktop app and `pnpm start` share
 * ~/.bukitjalil, and two servers on it would fight over app.db and the working copies. A lock left by a
 * process that no longer runs is taken over. Returns a function that releases it.
 */
export function acquireHomeLock(file: string, pid = process.pid): () => void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, `${pid}\n`, { flag: "wx", mode: 0o600 });
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        // Only our own lock; a takeover after we were thought dead is not ours to remove.
        if (holder(file) === pid) fs.rmSync(file, { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const { pid: other, complete } = read(file);
      if (other !== null && other !== pid && alive(other)) throw new HomeInUseError(file, other);
      // A lock written just now may still be mid-write: without its closing newline even a readable PID can
      // be partial. Wait for the grace period before taking such a lock over. A complete line naming a dead
      // process is a crash left behind and is taken over at once, so "Start again" works right after a crash.
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (!complete && stat && Date.now() - stat.mtimeMs < LOCK_WRITE_GRACE_MS) {
        throw new HomeInUseError(file, other ?? 0);
      }
      // Stale (or our own pid from a previous life): remove and try once more.
      fs.rmSync(file, { force: true });
    }
  }
  throw new HomeInUseError(file, holder(file) ?? 0);
}
