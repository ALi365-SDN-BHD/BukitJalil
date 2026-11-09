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
  // mkdir's mode only applies to new directories, so existing ones are tightened as well. The database
  // is created empty with 0600 before SQLite opens it; SQLite gives -wal / -shm the same mode.
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.logs, { recursive: true, mode: 0o700 });
  fs.chmodSync(home, 0o700);
  fs.chmodSync(paths.logs, 0o700);
  for (const file of [paths.db, paths.emptyGitConfig]) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, "", { mode: 0o600 });
  }
  for (const file of [paths.db, `${paths.db}-wal`, `${paths.db}-shm`, path.join(paths.logs, "server.log")]) {
    if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  }
  return paths;
}
