import fs from "node:fs";
import path from "node:path";
import type { BukitStatus } from "@bukitjalil/shared";
import { versionAtLeast } from "../git/version.ts";
import { runProbe } from "../probe.ts";
import { BUKIT_VERSION, MIN_BUKIT_VERSION } from "./install.ts";
import { parseBukitVersion } from "./runner.ts";

/**
 * Where Bukit comes from (plan 8.1): only the copy that ships with BukitJalil, in `<resources>/bukit/`
 * (the development copy is vendor/bukit-<version>/, from `pnpm fetch:bukit`). Nothing is installed or
 * upgraded at run time.
 */

/** The executable name inside a Bukit package. */
export const BUKIT_EXE = process.platform === "win32" ? "bukit.exe" : "bukit";

/** The development copy's directory, from `pnpm fetch:bukit`; its name changes with BUKIT_VERSION. */
export const devBukitDir = (repoRoot: string, version: string = BUKIT_VERSION) =>
  path.join(repoRoot, "vendor", `bukit-${version}`);

function executableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** `bukit version` with a minimal environment; null if it cannot run or prints no version. */
export async function probeBukitVersion(bukitPath: string, tmpDir: string): Promise<string | null> {
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const result = await runProbe(bukitPath, ["version"], {
    PATH: "/usr/bin:/bin",
    LANG: "C.UTF-8",
    TMPDIR: tmpDir,
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  });
  return result.ok ? parseBukitVersion(result.stdout) : null;
}

/** Releases in the bundled version's minor line (2.1.x) are supported; another minor may change behaviour. */
const SUPPORTED_LINE = `${BUKIT_VERSION.split(".").slice(0, 2).join(".")}.`;

export function versionState(version: string): "ok" | "old" | "unsupported" {
  if (!version.startsWith(SUPPORTED_LINE)) {
    // An earlier minor of the same major (2.0.x) is only too old; a later one, or another major, is unknown.
    const sameMajor = version.split(".")[0] === SUPPORTED_LINE.split(".")[0];
    return sameMajor && !versionAtLeast(version, SUPPORTED_LINE.slice(0, -1)) ? "old" : "unsupported";
  }
  return versionAtLeast(version, MIN_BUKIT_VERSION) ? "ok" : "old";
}

/** The Bukit in `dir` (the bundled copy), and whether it runs. */
export async function locateBukit(opts: { dir: string; tmpDir: string }): Promise<BukitStatus> {
  const file = path.join(opts.dir, BUKIT_EXE);
  const base = { path: file, bundledVersion: BUKIT_VERSION };
  if (!executableFile(file)) return { ...base, path: null, version: null, state: "missing" };
  const version = await probeBukitVersion(file, opts.tmpDir);
  if (!version) return { ...base, version: null, state: "broken" };
  return { ...base, version, state: versionState(version) };
}

/**
 * Remove the copies earlier versions of BukitJalil installed in ~/.bukitjalil/bin/bukit-<version>/ (plan
 * 8.1): Bukit now ships with the app. Only directories named bukit-*; the rest of bin/ (git) stays.
 */
export function removeOldAppCopies(home: string): void {
  const bin = path.join(home, "bin");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(bin, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("bukit-")) {
      fs.rmSync(path.join(bin, entry.name), { recursive: true, force: true });
    }
  }
}

/**
 * Bukit status for the API: located once and cached, because each probe starts a process. The settings
 * page asks for a fresh look when it opens.
 */
export class BukitService {
  private cached: Promise<BukitStatus> | null = null;

  constructor(private readonly opts: { dir: string; tmpDir: string }) {}

  status(): Promise<BukitStatus> {
    if (!this.cached) {
      const located = locateBukit(this.opts);
      this.cached = located;
      // A failed lookup is not cached: the next request tries again.
      located.catch(() => {
        if (this.cached === located) this.cached = null;
      });
    }
    return this.cached;
  }

  /** Drop the located status, so the next request probes again. */
  invalidate(): void {
    this.cached = null;
  }
}
