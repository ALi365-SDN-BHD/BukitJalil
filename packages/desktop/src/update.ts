import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Replace the running AppImage with a verified download, then let the caller relaunch it. Linux allows
 * renaming over a running executable; the old process keeps its open inode. Only used on Linux.
 */
export async function replaceAppImage(
  downloaded: string,
  running: string,
  relaunch: (file: string) => void,
): Promise<string | null> {
  let temp: string | undefined;
  try {
    const target = await fsp.realpath(running);
    if (!target.endsWith(".AppImage")) return "not an AppImage";
    const stat = await fsp.stat(target);
    if (!stat.isFile()) return "not a file";
    temp = path.join(path.dirname(target), `.${path.basename(target)}.update-${process.pid}`);
    await fsp.copyFile(downloaded, temp);
    await fsp.chmod(temp, 0o755);
    await fsp.rename(temp, target);
    relaunch(target);
    return null;
  } catch (err) {
    if (temp) await fsp.rm(temp, { force: true }).catch(() => {});
    return err instanceof Error ? err.message : String(err);
  }
}
