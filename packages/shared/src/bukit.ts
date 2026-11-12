/** GET /api/bukit (plan 8.1, 10.x). Install progress is polled from the same endpoint. */

export interface BukitStatus {
  path: string | null;
  version: string | null;
  /** The latest official release, from GitHub or the built-in fallback when it cannot be reached. */
  latestVersion: string;
  /** ok: 2.0.x and >= 2.0.11 (the minimum); old: 2.0.x below 2.0.11; unsupported: not 2.0.x; broken: found but `bukit version` failed. */
  state: "ok" | "old" | "unsupported" | "missing" | "broken";
  /** An official package exists for this platform (osx-arm64, linux-x64, win-x64). */
  installable: boolean;
  /** A working app copy older than the version BukitJalil installs (plan 8.1): offer the upgrade. */
  upgradable: boolean;
}

/** Progress of a download-and-install job (Bukit, rg), polled from its GET endpoint. */
export type InstallProgress =
  | { state: "idle" }
  | { state: "downloading"; received: number; total: number | null }
  | { state: "verifying" }
  | { state: "done" }
  | {
      state: "failed";
      code:
        | "unsupported_platform"
        | "download_failed"
        | "checksum_mismatch"
        | "bad_archive"
        | "too_large"
        | "install_failed"
        | "verify_failed";
      message: string;
    };

export interface BukitResponse {
  status: BukitStatus;
  install: InstallProgress;
}
