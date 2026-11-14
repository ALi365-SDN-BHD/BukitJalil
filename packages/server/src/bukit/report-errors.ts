import type { MediaProblem } from "@bukitjalil/shared";

const MAX_ERRORS = 5;
const MAX_ERROR_CHARS = 500;
const CLI_ERROR_SCHEMA = "https://bukit.dev/schemas/cli-error";

/**
 * The messages of Bukit's cli-error document (plan 8.6): on a failure Bukit 2.0.x prints an indented JSON
 * object (`schema: …/cli-error.v1.json`, `errors: [{ code, message }]`) on stderr. The last such document
 * wins; anything that does not parse is ignored.
 */
interface CliErrorEntry {
  code?: string;
  message?: string;
}

/** The entries of the last cli-error document in `text`, or null. */
function lastCliError(text: string): CliErrorEntry[] | null {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  for (let start = lines.length - 1; start >= 0; start--) {
    if (lines[start] !== "{") continue;
    const end = lines.indexOf("}", start + 1);
    if (end === -1) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(lines.slice(start, end + 1).join("\n"));
    } catch {
      continue;
    }
    const { schema, errors } = (doc ?? {}) as { schema?: unknown; errors?: unknown };
    if (typeof schema !== "string" || !schema.startsWith(CLI_ERROR_SCHEMA) || !Array.isArray(errors)) continue;
    const entries: CliErrorEntry[] = [];
    for (const error of errors) {
      if (!error || typeof error !== "object") continue;
      const entry: CliErrorEntry = {};
      const code = (error as { code?: unknown }).code;
      const message = (error as { message?: unknown }).message;
      if (typeof code === "string") entry.code = code;
      if (typeof message === "string") entry.message = message;
      entries.push(entry);
    }
    return entries;
  }
  return null;
}

/** The messages of Bukit's cli-error document (plan 8.6), capped. */
export function bukitErrorsIn(text: string): string[] {
  return (lastCliError(text) ?? [])
    .map((entry) => entry.message ?? "")
    .filter((message) => message.trim() !== "")
    .slice(0, MAX_ERRORS)
    .map((message) => message.slice(0, MAX_ERROR_CHARS));
}

/** The stable `code` values of the last cli-error document, for the BKT-0Bxx recognition (plan 5.4). */
export function bukitErrorCodesIn(text: string): string[] {
  return (lastCliError(text) ?? [])
    .map((entry) => entry.code ?? "")
    .filter((code) => code.trim() !== "")
    .slice(0, MAX_ERRORS);
}

const PLACEHOLDER_MISSING = "Referenced localized media output is missing: ";
const PLACEHOLDER_DETAIL = " (content.media.defaultImageUrl";

/**
 * A placeholder the build needed but the site does not have (plan 8.6): Bukit replaces a remote
 * image it could not download with `content.media.defaultImageUrl` (onFailure: placeholder), then fails with
 * "Referenced localized media output is missing: <path>" when that file is not in the site. The path comes
 * from Bukit's parsed error messages, else from the raw output. Bukit's other check ("… is missing or unsafe")
 * is about downloaded files, which `keep` does not fix, so it is left to the error messages.
 * `failedDownloads` adds up the `event=media.localize_summary … failed=N` counts. Check these texts when
 * Bukit is upgraded.
 */
export function mediaProblemIn(text: string, errors: string[] = []): MediaProblem | null {
  // Bukit 2.1 may follow the path with " (content.media.defaultImageUrl, …)" and the fixes: keep the path only.
  const fromErrors = errors
    .find((e) => e.startsWith(PLACEHOLDER_MISSING))
    ?.slice(PLACEHOLDER_MISSING.length)
    .split(PLACEHOLDER_DETAIL, 1)[0]
    ?.trim();
  const missing = fromErrors || /Referenced localized media output is missing: ([^\s"\\]+)/.exec(text)?.[1];
  if (!missing) return null;
  let failedDownloads = 0;
  for (const match of text.matchAll(/event=media\.localize_summary\b[^\n]*?\bfailed=(\d+)/g)) {
    failedDownloads += Number(match[1]);
  }
  return { missing: missing.slice(0, 300), failedDownloads };
}
