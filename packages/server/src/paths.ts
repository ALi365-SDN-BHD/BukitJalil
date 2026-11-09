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
  /** Empty directory used as core.hooksPath for every git call (plan 7.3). */
  emptyHooks: string;
  /** TMPDIR for Bukit (plan 8.2). */
  bukitTmp: string;
  /** worktrees/<siteId>/{ai,main} (plan 4.1). */
  worktrees: string;
  sessions: string;
  previews: string;
  /** Scratch space for git work that must not touch a user's directory. */
  tmp: string;
}

export function ensureAppHome(home: string): AppPaths {
  const paths: AppPaths = {
    home,
    db: path.join(home, "app.db"),
    logs: path.join(home, "logs"),
    emptyGitConfig: path.join(home, "empty-gitconfig"),
    emptyHooks: path.join(home, "empty-hooks"),
    bukitTmp: path.join(home, "tmp", "bukit"),
    worktrees: path.join(home, "worktrees"),
    sessions: path.join(home, "sessions"),
    previews: path.join(home, "previews"),
    tmp: path.join(home, "tmp"),
  };
  // mkdir's mode only applies to new directories, so existing ones are tightened as well. The database
  // is created empty with 0600 before SQLite opens it; SQLite gives -wal / -shm the same mode.
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.logs, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.emptyHooks, { recursive: true, mode: 0o700 });
  for (const dir of [paths.bukitTmp, paths.worktrees, paths.sessions, paths.previews]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.chmodSync(home, 0o700);
  fs.chmodSync(paths.logs, 0o700);
  for (const file of [paths.db, paths.emptyGitConfig]) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, "", { mode: 0o600 });
  }
  for (const file of [paths.db, `${paths.db}-wal`, `${paths.db}-shm`, path.join(paths.logs, "server.log")]) {
    if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  }
  // git hardening relies on these being empty; refuse to start rather than run git with them.
  if (fs.lstatSync(paths.emptyGitConfig).size !== 0 || !fs.lstatSync(paths.emptyGitConfig).isFile()) {
    throw new Error(`${paths.emptyGitConfig} must be an empty file; delete it and restart`);
  }
  if (fs.lstatSync(paths.emptyHooks).isSymbolicLink() || fs.readdirSync(paths.emptyHooks).length > 0) {
    throw new Error(`${paths.emptyHooks} must be an empty directory; delete it and restart`);
  }
  return paths;
}
