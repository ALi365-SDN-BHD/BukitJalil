import type { InstallProgress } from "./bukit.ts";

/** GET /api/rg (plan 6.3): the ripgrep the AI's grep tool runs. */
export interface RgStatus {
  /** ok: the pinned rg is installed and its SHA-256 matches; mismatch: a file is there but does not match. */
  state: "ok" | "missing" | "mismatch";
  /** The pinned version, e.g. "15.2.0". */
  version: string;
  /** A pinned package exists for this platform (macOS and Linux, arm64 and x64). */
  installable: boolean;
}

export interface RgResponse {
  status: RgStatus;
  install: InstallProgress;
}
