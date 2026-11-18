import path from "node:path";

/**
 * Pieces of the explicit, minimal environments that BukitJalil gives to git, Bukit and rg. Nothing is
 * inherited from the server's own environment (plan 7.3, 8.2); these only differ by platform.
 */

/** What a Windows program cannot start without. Other variables, USERPROFILE included, are not passed. */
const WINDOWS_SYSTEM_VARS = ["SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT"] as const;

/** System variables for a child process: the Windows ones taken from `source`, nothing elsewhere. */
export function systemEnv(
  platform: string = process.platform,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (platform !== "win32") return {};
  const env: Record<string, string> = {};
  for (const name of WINDOWS_SYSTEM_VARS) {
    const value = source[name];
    if (value) env[name] = value;
  }
  return env;
}

/** The private temporary directory: TMPDIR, and also TEMP and TMP on Windows, which is what .NET and git read there. */
export function tempEnv(dir: string, platform: string = process.platform): Record<string, string> {
  return platform === "win32" ? { TMPDIR: dir, TEMP: dir, TMP: dir } : { TMPDIR: dir };
}

/**
 * A PATH made of `dirs` and, off Windows, the system directories. On Windows there is no /usr/bin or /bin
 * to fall back on: git finds its own tools through its install layout, so only `dirs` are listed.
 */
export function searchPath(dirs: readonly string[], platform: string = process.platform): string {
  return (platform === "win32" ? [...dirs] : [...dirs, "/usr/bin", "/bin"]).join(
    platform === "win32" ? ";" : path.delimiter,
  );
}
