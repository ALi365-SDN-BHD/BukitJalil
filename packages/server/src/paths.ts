import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { devBukitDir } from "./bukit/locate.ts";

/**
 * The app version from one explicit package.json: the repository root in development,
 * Resources/app/package.json in the desktop app. BUKITJALIL_VERSION still wins where it is set.
 */
export function readPackageVersion(file: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: unknown; version?: unknown };
    return pkg.name === "bukitjalil" && typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : null;
  } catch {
    return null;
  }
}

/** Application data directory (plan 4.1); BUKITJALIL_HOME overrides ~/.bukitjalil. */
export function resolveAppHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.BUKITJALIL_HOME;
  return path.resolve(override && override.length > 0 ? override : path.join(os.homedir(), ".bukitjalil"));
}

/** Files the server ships with: the AI skills, the built web pages, Bukit and the theme sample content. */
export interface ResourcePaths {
  skills: string;
  web: string;
  /** The directory holding the bundled Bukit executable (plan 8.1). */
  bukit: string;
  /** Sample content for theme projects (theme development design 3.4). */
  themeDemo: string;
}

/**
 * Where those files are (plan M7, 8.1): BUKITJALIL_RESOURCES names the desktop app's resources folder
 * (skills/, web/, bukit/, theme-demo/); without it they are read from the repository, with Bukit in
 * vendor/bukit-<version>/ from `pnpm fetch:bukit`. BUKITJALIL_BUKIT_DIR picks another Bukit directory, for
 * tests and CI only: the packaged app (BUKITJALIL_RESOURCES set) always uses the copy it ships with.
 */
export function resolveResources(repoRoot: string, env: NodeJS.ProcessEnv = process.env): ResourcePaths {
  const root = env.BUKITJALIL_RESOURCES;
  if (root && root.length > 0) {
    const dir = path.resolve(root);
    return {
      skills: path.join(dir, "skills"),
      web: path.join(dir, "web"),
      bukit: path.join(dir, "bukit"),
      themeDemo: path.join(dir, "theme-demo"),
    };
  }
  const bukitDir = env.BUKITJALIL_BUKIT_DIR;
  const bukit = bukitDir && bukitDir.length > 0 ? path.resolve(bukitDir) : null;
  return {
    skills: path.join(repoRoot, "skills"),
    web: path.join(repoRoot, "packages", "web", "dist"),
    bukit: bukit ?? devBukitDir(repoRoot),
    themeDemo: path.join(repoRoot, "packages", "server", "assets", "theme-demo"),
  };
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
  previews: string;
  /** Notion offline snapshots and their media caches, notion-snapshots/<siteId>/ (plan 5.5). */
  notionSnapshots: string;
  /** Pi's agentDir and PI_CODING_AGENT_DIR: models.json (plan 6.1); keys are in the database (plan 6.9). */
  pi: string;
  /** rg installed and checked by BukitJalil (plan 6.3). */
  piBin: string;
  /** Scratch space for git work that must not touch a user's directory. */
  tmp: string;
  /** Site captures handed from the desktop app to the server (design 6.2), captures/<id>/. */
  captures: string;
  /** Pid of the server using this directory (plan M7). */
  lock: string;
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
    previews: path.join(home, "previews"),
    notionSnapshots: path.join(home, "notion-snapshots"),
    pi: path.join(home, "pi"),
    piBin: path.join(home, "pi", "bin"),
    tmp: path.join(home, "tmp"),
    captures: path.join(home, "captures"),
    lock: path.join(home, "server.lock"),
  };
  // mkdir's mode only applies to new directories, so existing ones are tightened as well. The database
  // is created empty with 0600 before SQLite opens it; SQLite gives -wal / -shm the same mode.
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.logs, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.emptyHooks, { recursive: true, mode: 0o700 });
  for (const dir of [
    paths.bukitTmp,
    paths.worktrees,
    paths.previews,
    paths.notionSnapshots,
    paths.piBin,
    paths.captures,
  ]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.chmodSync(home, 0o700);
  fs.chmodSync(paths.logs, 0o700);
  // Pi's models.json and device id; model keys are in the database (plan 6.9).
  fs.chmodSync(paths.pi, 0o700);
  for (const file of [paths.db, paths.emptyGitConfig]) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, "", { mode: 0o600 });
  }
  for (const file of [paths.db, `${paths.db}-wal`, `${paths.db}-shm`, path.join(paths.logs, "server.log")]) {
    // lstat, not exists: a symlink must not make startup chmod a file outside the app home.
    if (fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()) fs.chmodSync(file, 0o600);
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
