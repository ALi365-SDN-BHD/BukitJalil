import fs from "node:fs";

/** O_NOFOLLOW where the platform has it; Windows has none, and the constant is undefined there. */
export const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/**
 * Refuse a symbolic link (or a Windows junction) in the last segment of `file`. Where O_NOFOLLOW exists the
 * open flag already refuses it and this is an extra guard; on Windows it is the only one, and a link swapped
 * in between this check and the open is not caught (the gate's own real-path check runs just before).
 */
export function assertNotLink(file: string): void {
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw Object.assign(new Error(`ELOOP: ${file} is a link`), { code: "ELOOP" });
  }
}
