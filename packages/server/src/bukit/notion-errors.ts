import type { NotionProblem, NotionSnapshotProblem } from "@bukitjalil/shared";
import { bukitErrorCodesIn } from "./report-errors.ts";

/**
 * Notion failures in Bukit's output (plan 5.4, Bukit 2.2.0). Bukit writes stable `BKT-0Bxx` codes:
 * the cli-error `code` for build/deploy, and `[BKT-0Bxx]` / `✖ [BKT-0Bxx]` lines for config check and
 * doctor. Only the cli-error code and the line-start codes count; warnings (`⚠ …`) and lines such as
 * `Error: [BKT-…]` (a multilingual worker's forwarded text) are not errors of the run.
 */
const NOTION_CODES: Record<string, NotionProblem> = {
  "BKT-0B01": "unauthorized",
  "BKT-0B02": "forbidden",
  "BKT-0B03": "not_shared",
  "BKT-0B04": "rate_limited",
  "BKT-0B05": "property_missing",
  "BKT-0B06": "request_failed",
  "BKT-0B07": "network",
  "BKT-0B08": "request_failed",
};

/** Snapshot codes by the change the user sees: 0B10/0B14 are stale, 0B11–0B13 are caused by the change. */
const SNAPSHOT_CODES: Record<string, NotionSnapshotProblem> = {
  "BKT-0B10": "stale",
  "BKT-0B11": "change",
  "BKT-0B12": "change",
  "BKT-0B13": "change",
  "BKT-0B14": "stale",
};

const CODE = /^BKT-0B[0-9A-F]{2}$/;
const LINE_CODE = /^(?:✖ )?\[(BKT-0B[0-9A-F]{2})\]/;

/** The Notion codes of the last cli-error document, else the last line-start codes of the full output. */
function codesIn(stderr: string, output: string): string[] {
  const cli = bukitErrorCodesIn(stderr).filter((code) => CODE.test(code));
  if (cli.length > 0) return cli;
  const codes: string[] = [];
  for (const line of output.split("\n")) {
    const match = LINE_CODE.exec(line.replace(/\r$/, ""));
    if (match?.[1] !== undefined) codes.push(match[1]);
  }
  return codes;
}

/**
 * The Notion failure that ended a failed run, or null (plan 5.4). The cli-error `code` wins; otherwise
 * the last line-start `[BKT-0Bxx]` / `✖ [BKT-0Bxx]` from config check or doctor is used.
 */
export function notionProblemIn(stderr: string, output: string = stderr): NotionProblem | null {
  for (const code of codesIn(stderr, output)) {
    const problem = NOTION_CODES[code];
    if (problem !== undefined) return problem;
  }
  return null;
}

/**
 * An offline build that could not use the Notion snapshot (plan 5.5). 0B10/0B14 are `stale` (record the
 * snapshot again); 0B11–0B13 are `change` (the change needs data the formal build did not read); 0B15–0B17
 * are not classified and stay in Bukit's original error.
 */
export function notionSnapshotProblemIn(stderr: string, output: string = stderr): NotionSnapshotProblem | null {
  for (const code of codesIn(stderr, output)) {
    const problem = SNAPSHOT_CODES[code];
    if (problem !== undefined) return problem;
  }
  return null;
}
