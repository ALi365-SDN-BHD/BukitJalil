import fs from "node:fs";
import path from "node:path";

/** Homebrew's executable, from the usual prefixes or the user's PATH. */
export function findBrew(envPath = process.env.PATH ?? ""): string | null {
  const candidates = [
    "/opt/homebrew/bin/brew",
    "/usr/local/bin/brew",
    "/home/linuxbrew/.linuxbrew/bin/brew",
    ...envPath
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, "brew")),
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
    } catch {
      // not here
    }
  }
  return null;
}

/** The prefix Homebrew owns; a Git under it was installed by Homebrew. */
export function brewPrefix(brew: string): string {
  return path.dirname(path.dirname(brew));
}
