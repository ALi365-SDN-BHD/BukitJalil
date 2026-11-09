/**
 * Repository config allowlist (plan 7.3). Listing dangerous keys never ends (core.fsmonitor, gpg.program,
 * filter drivers, ...), so only keys known to be harmless are allowed in the repository and worktree
 * scopes; anything else makes the site read-only. The list includes what M1 found in 71 real repositories.
 */

export interface RepoCheck {
  ok: boolean;
  /** Machine-readable reasons, e.g. "config:core.fsmonitor", "config:include.path", "attributes:filter". */
  reasons: string[];
}

const EXACT = new Set([
  "core.repositoryformatversion",
  "core.filemode",
  "core.bare",
  "core.logallrefupdates",
  "core.ignorecase",
  "core.precomposeunicode",
  "core.symlinks",
  "core.autocrlf",
  "core.eol",
  "user.name",
  "user.email",
  "submodule.active",
  "lfs.repositoryformatversion",
  "extensions.worktreeconfig",
]);

/** Patterns for keys with a user-chosen middle part (remote name, branch name, LFS URL). */
const PATTERNS: RegExp[] = [
  /^remote\..+\.(?:url|pushurl|fetch)$/,
  /^branch\..+\.(?:remote|merge|rebase|vscode-merge-base)$/,
  /^lfs\..+\.access$/,
];

/** Scopes that belong to the repository; "command" is our own -c, global/system are disabled. */
const REPO_SCOPES = new Set(["local", "worktree"]);

export function isAllowedConfigKey(key: string): boolean {
  // git prints section and variable names in lower case; the middle part keeps its case.
  const lower = key.toLowerCase();
  if (lower.startsWith("include.") || lower.startsWith("includeif.")) return false;
  if (EXACT.has(lower)) return true;
  const dot1 = key.indexOf(".");
  const dot2 = key.lastIndexOf(".");
  const normalized =
    dot1 > 0 && dot2 > dot1
      ? `${key.slice(0, dot1).toLowerCase()}${key.slice(dot1, dot2)}${key.slice(dot2).toLowerCase()}`
      : lower;
  return PATTERNS.some((p) => p.test(normalized));
}

/**
 * @param listZ output of `git config --list --show-scope --includes -z`: records `scope\0key\nvalue\0`
 * @param infoAttributes contents of `.git/info/attributes` ("" if missing)
 */
export function checkRepoConfig(listZ: string, infoAttributes: string): RepoCheck {
  const reasons = new Set<string>();
  const parts = listZ.split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const scope = parts[i] ?? "";
    const entry = parts[i + 1] ?? "";
    if (!REPO_SCOPES.has(scope)) continue;
    const nl = entry.indexOf("\n");
    const key = nl === -1 ? entry : entry.slice(0, nl);
    if (!isAllowedConfigKey(key)) reasons.add(`config:${key.toLowerCase()}`);
  }
  if (/(^|\s)filter(=|\s|$)/m.test(stripComments(infoAttributes))) reasons.add("attributes:filter");
  return { ok: reasons.size === 0, reasons: [...reasons].sort() };
}

function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}
