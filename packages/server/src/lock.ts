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

function holder(file: string): number | null {
  try {
    const pid = Number(fs.readFileSync(file, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * A lock file becomes visible as soon as it is opened, before its PID is written. A second process can read
 * it in that tiny window. Treat a fresh but empty/unreadable file as held for this long instead of deleting
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
      const other = holder(file);
      if (other !== null && other !== pid && alive(other)) throw new HomeInUseError(file, other);
      // A lock written just now may still be mid-write (even a readable, not-yet-dead PID can be partial).
      // Wait for the grace period before taking it over; a crashed process's lock can be removed after it.
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (stat && Date.now() - stat.mtimeMs < LOCK_WRITE_GRACE_MS) throw new HomeInUseError(file, other ?? 0);
      // Stale (or our own pid from a previous life): remove and try once more.
      fs.rmSync(file, { force: true });
    }
  }
  throw new HomeInUseError(file, holder(file) ?? 0);
}
