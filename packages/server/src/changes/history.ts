import type { HistoryEntry } from "@bukitjalil/shared";
import type { GitRunner } from "../git/run.ts";

/** Versions per page of the history (plan 7.4). */
export const HISTORY_PAGE = 50;

/** The fixed author of applied AI changes (plan 7.2). */
export const AI_AUTHOR_NAME = "BukitJalil AI";
export const AI_AUTHOR_EMAIL = "ai@bukitjalil.local";

const SESSIONS_TRAILER = "BukitJalil-Sessions:";
const RESTORE_TRAILER = "BukitJalil-Restore:";

/**
 * A page of the default branch's history, newest first, following first parents only (the line of
 * versions the site went through). Two `git log` calls with the same range: one for the commits, one for
 * the changed-file counts (`--shortstat` prints no file names, so nothing in it can be mistaken for a
 * separator). Both read the same head, resolved first, so an apply landing in between cannot shift one.
 */
export async function listHistory(
  git: GitRunner,
  cwd: string,
  branch: string,
  opts: { skip: number; limit?: number },
): Promise<{ entries: HistoryEntry[]; hasMore: boolean }> {
  const limit = opts.limit ?? HISTORY_PAGE;
  const head = (
    await git.text(["rev-parse", "--verify", "--end-of-options", `refs/heads/${branch}^{commit}`], { cwd })
  ).trim();
  const range = [`--max-count=${limit + 1}`, `--skip=${opts.skip}`, "--end-of-options", head, "--"];
  const [log, stat] = await Promise.all([
    git.text(["log", "-z", "--first-parent", "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%B", ...range], { cwd }),
    git.text(
      [
        "log",
        "--first-parent",
        "--diff-merges=first-parent",
        "--no-renames",
        "--format=format:%x00%H",
        "--shortstat",
        ...range,
      ],
      { cwd },
    ),
  ]);
  const counts = new Map<string, number>();
  for (const chunk of stat.split("\0").slice(1)) {
    const [hash = "", ...rest] = chunk.split("\n");
    const match = /(\d+) files? changed/.exec(rest.join("\n"));
    counts.set(hash.trim(), match ? Number(match[1]) : 0);
  }
  const fields = log === "" ? [] : log.split("\0");
  const entries: HistoryEntry[] = [];
  for (let i = 0; i + 5 < fields.length; i += 6) {
    const [commit = "", parents = "", authorName = "", authorEmail = "", date = "", message = ""] = fields.slice(
      i,
      i + 6,
    );
    entries.push(toEntry({ commit, parents, authorName, authorEmail, date, message }, counts.get(commit) ?? 0));
  }
  return { entries: entries.slice(0, limit), hasMore: entries.length > limit };
}

/** One commit as a history entry (it must exist). */
export async function historyEntry(git: GitRunner, cwd: string, commit: string): Promise<HistoryEntry> {
  const page = await git.text(
    ["log", "-z", "--max-count=1", "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%B", "--end-of-options", commit, "--"],
    { cwd },
  );
  const [hash = "", parents = "", authorName = "", authorEmail = "", date = "", message = ""] = page.split("\0");
  const stat = await git.text(
    [
      "show",
      "--diff-merges=first-parent",
      "--no-renames",
      "--format=format:",
      "--shortstat",
      "--end-of-options",
      commit,
      "--",
    ],
    { cwd },
  );
  const match = /(\d+) files? changed/.exec(stat);
  return toEntry({ commit: hash, parents, authorName, authorEmail, date, message }, match ? Number(match[1]) : 0);
}

/** A commit's parents, first parent first. */
export async function parentsOf(git: GitRunner, cwd: string, commit: string): Promise<string[]> {
  const line = await git.text(["rev-list", "--parents", "--max-count=1", "--end-of-options", commit, "--"], { cwd });
  return line.trim().split(" ").slice(1);
}

/** Whether `commit` is a commit on the default branch's history (so it may be shown or restored). */
export async function onBranch(git: GitRunner, cwd: string, commit: string, branch: string): Promise<boolean> {
  const type = await git.run(["cat-file", "-t", "--end-of-options", commit], { cwd, okCodes: [1, 128] });
  if (type.code !== 0 || type.stdout.toString("utf8").trim() !== "commit") return false;
  const res = await git.run(["merge-base", "--is-ancestor", "--end-of-options", commit, `refs/heads/${branch}`], {
    cwd,
    okCodes: [1],
  });
  return res.code === 0;
}

/** The empty tree of this repository's hash algorithm (the "parent" of a first commit). */
export async function emptyTree(git: GitRunner, cwd: string): Promise<string> {
  return (await git.text(["mktree"], { cwd, input: "" })).trim();
}

function toEntry(
  raw: { commit: string; parents: string; authorName: string; authorEmail: string; date: string; message: string },
  filesChanged: number,
): HistoryEntry {
  const lines = raw.message.replace(/\s+$/, "").split("\n");
  let sessionIds: string[] = [];
  let restoreOf: string | null = null;
  const kept: string[] = [];
  // Trailers are the last paragraph only; a line in the subject or body is never one, whatever it says.
  const trailersFrom = lines.lastIndexOf("") + 1;
  for (const [i, line] of lines.entries()) {
    if (i === 0 || trailersFrom === 0 || i < trailersFrom) kept.push(line);
    else if (line.startsWith(SESSIONS_TRAILER)) {
      sessionIds = line
        .slice(SESSIONS_TRAILER.length)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[0-9a-f]{16}$/.test(s));
    } else if (line.startsWith(RESTORE_TRAILER)) {
      const oid = line.slice(RESTORE_TRAILER.length).trim();
      if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)) restoreOf = oid;
    } else kept.push(line);
  }
  const [subject = "", ...rest] = kept;
  return {
    commit: raw.commit,
    parents: raw.parents.split(" ").filter(Boolean),
    subject,
    body: rest.join("\n").trim(),
    authorName: raw.authorName,
    authorEmail: raw.authorEmail,
    date: raw.date,
    filesChanged,
    sessionIds,
    restoreOf,
    byAi: raw.authorEmail === AI_AUTHOR_EMAIL,
  };
}
