/** GET /api/git: the system or Homebrew Git the app uses, and the latest Homebrew release. */
export type GitState = "ok" | "missing" | "too_old" | "broken";
export type GitSource = "app" | "homebrew" | "system" | "path" | null;

/** Commands shown when the app cannot install Git itself on this platform. */
export interface GitGuideCommand {
  title: string;
  command: string;
}

export interface GitStatus {
  path: string | null;
  version: string | null;
  /** The latest official Git release, or null when the check was skipped or failed. */
  latestVersion: string | null;
  source: GitSource;
  state: GitState;
  /** System platform of the server: darwin, linux, win32, ... */
  platform: string;
  /** Detected package manager/tool for this platform, e.g. homebrew, apt, dnf, pacman, winget. */
  packageManager: string | null;
  /** Platform-specific commands for the install/update guide. */
  guide: GitGuideCommand[];
  /** Homebrew is available, so the app can install or update Git without admin rights. */
  installable: boolean;
  /** A newer Git is available and Homebrew can install it. */
  updatable: boolean;
}

export type GitInstallProgress =
  | { state: "idle" }
  | { state: "running"; message: string }
  | { state: "done"; version: string | null }
  | { state: "failed"; message: string };

export interface GitResponse {
  status: GitStatus;
  install: GitInstallProgress;
}
