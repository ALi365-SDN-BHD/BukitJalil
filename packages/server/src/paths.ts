import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Application data directory (plan 4.1); BUKITJALIL_HOME overrides ~/.bukitjalil. */
export function resolveAppHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.BUKITJALIL_HOME;
  return path.resolve(override && override.length > 0 ? override : path.join(os.homedir(), ".bukitjalil"));
}

export interface AppPaths {
  home: string;
  db: string;
  logs: string;
  emptyGitConfig: string;
}

export function ensureAppHome(home: string): AppPaths {
  const paths: AppPaths = {
    home,
    db: path.join(home, "app.db"),
    logs: path.join(home, "logs"),
    emptyGitConfig: path.join(home, "empty-gitconfig"),
  };
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.logs, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(paths.emptyGitConfig)) fs.writeFileSync(paths.emptyGitConfig, "", { mode: 0o600 });
  return paths;
}
