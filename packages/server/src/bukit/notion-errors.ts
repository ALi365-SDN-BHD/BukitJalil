import type { NotionProblem } from "@bukitjalil/shared";

/**
 * Notion failures in Bukit's output (plan 5.4). Bukit 2.0.15 drops Notion's own error code and keeps the
 * HTTP status: NotionClient throws "Notion request failed: <status> <reason>", "Notion request rate limited:
 * 429 …" and "Notion request failed due to a transport error."; the content parser throws "Notion database
 * property '<name>' not found …". Check these texts when Bukit is upgraded.
 */
const PATTERNS: [RegExp, NotionProblem][] = [
  [/Notion request failed: 401\b/, "unauthorized"],
  [/Notion request failed: 404\b/, "not_shared"],
  [/Notion request failed: 403\b/, "forbidden"],
  [/Notion request rate limited\b/, "rate_limited"],
  [/Notion database property '[^'\n]*' not found/, "property_missing"],
  [/Notion request failed due to a transport error/, "network"],
  // `bukit doctor` (run before a publish) prints its own line for an HTTP failure of the database check.
  [/Notion database check failed: 401\b/, "unauthorized"],
  [/Notion database check failed: 404\b/, "not_shared"],
  [/Notion database check failed: 403\b/, "forbidden"],
  [/Notion database check failed: 429\b/, "rate_limited"],
];

/**
 * Warnings that name a Notion request failure without failing the run: a relation target the build skips,
 * and doctor's connectivity check, after which doctor goes on.
 */
const NOT_FATAL = /event=notion\.relation\.resolve_failed|Notion API connectivity check failed/;

/**
 * The Notion failure that ended a failed run, or null: the last one named in `text` (Bukit prints the error
 * that stopped it at the end), ignoring warnings that do not stop a build.
 */
export function notionProblemIn(text: string): NotionProblem | null {
  const lines = text.split("\n").filter((line) => !NOT_FATAL.test(line));
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] as string;
    let last: { at: number; problem: NotionProblem } | null = null;
    for (const [pattern, problem] of PATTERNS) {
      const at = line.search(pattern);
      if (at !== -1 && (last === null || at > last.at)) last = { at, problem };
    }
    if (last) return last.problem;
  }
  return null;
}
