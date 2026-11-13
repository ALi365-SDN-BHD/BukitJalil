/** GET /api/bukit (plan 8.1): the Bukit that ships with BukitJalil. There is no install or upgrade. */

export interface BukitStatus {
  /** The bundled executable; null when it is missing. */
  path: string | null;
  /** What `bukit version` printed; null when missing or it does not run. */
  version: string | null;
  /** The version this BukitJalil ships (BUKIT_VERSION). */
  bundledVersion: string;
  /** ok: 2.0.x and >= the minimum; old: 2.0.x below it; unsupported: not 2.0.x; broken: found but `bukit version` failed. */
  state: "ok" | "old" | "unsupported" | "missing" | "broken";
}

/** Progress of a download-and-install job (rg), polled from its GET endpoint. */
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
}
