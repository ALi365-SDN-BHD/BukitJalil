import type { FileDiff } from "@bukitjalil/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import { PanelError, PanelLoading } from "@/features/panels/common";
import { useI18n } from "@/i18n";
import { HUNK_HEADER } from "./selection";

/** Which hunks applying takes (plan 7.5); `total` is how many the shown patch has. */
export interface HunkChoice {
  on: (index: number) => boolean;
  set: (index: number, on: boolean, total: number) => void;
}

/**
 * One file's diff (plan 10.2): its path, then the patch, or why there is none to show. With `hunks`, each
 * hunk has a box that says whether applying takes it.
 */
export function FileDiffView({
  path,
  diff,
  hunks,
}: {
  path: string;
  diff: UseQueryResult<FileDiff>;
  hunks?: HunkChoice;
}) {
  const { m } = useI18n();
  const header = (
    <div className="flex h-9 shrink-0 items-center border-b px-3 text-xs">
      <code className="min-w-0 flex-1 truncate" title={path} data-testid="diff-path">
        {path}
      </code>
    </div>
  );
  let body: React.ReactNode;
  if (diff.isPending) body = <PanelLoading />;
  else if (diff.error) body = <PanelError error={diff.error} />;
  else {
    const note = diff.data.binary
      ? m.changes.binary
      : diff.data.tooLarge || diff.data.patch === null
        ? m.changes.tooLarge
        : null;
    body = note ? (
      <p className="p-6 text-sm text-muted-foreground" data-testid="diff-note">
        {note}
      </p>
    ) : (
      <PatchView path={path} patch={diff.data.patch ?? ""} hunks={hunks} />
    );
  }
  return (
    <>
      {header}
      {body}
    </>
  );
}

/** A unified diff, coloured by line; git's file header lines are left out (the path is shown above). */
function PatchView({ path, patch, hunks }: { path: string; patch: string; hunks?: HunkChoice }) {
  const { m } = useI18n();
  const lines = patch.split("\n");
  const start = lines.findIndex((l) => l.startsWith("@@"));
  const body = (start >= 0 ? lines.slice(start) : lines).filter((l, i, all) => !(l === "" && i === all.length - 1));
  const total = body.filter((l) => HUNK_HEADER.test(l)).length;
  let hunk = -1;
  return (
    <pre className="min-h-0 flex-1 overflow-auto py-1 font-mono text-xs leading-5" data-testid="diff-patch">
      {body.map((line, i) => {
        const header = HUNK_HEADER.test(line);
        if (header) hunk++;
        const index = hunk;
        const off = hunks && index >= 0 && !hunks.on(index);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines of a fixed patch
          <div key={i} className={`flex items-center px-3 whitespace-pre ${lineTone(line)} ${off ? "opacity-40" : ""}`}>
            {hunks && header && (
              <input
                type="checkbox"
                className="mr-2 shrink-0"
                checked={hunks.on(index)}
                onChange={(e) => hunks.set(index, e.target.checked, total)}
                aria-label={`${m.changes.includeHunk} ${index + 1}/${total}: ${path}`}
                title={m.changes.includeHunk}
                data-testid="include-hunk"
              />
            )}
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

function lineTone(line: string): string {
  if (line.startsWith("@@")) return "bg-muted text-muted-foreground";
  if (line.startsWith("+")) return "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300";
  if (line.startsWith("-")) return "bg-destructive/10 text-destructive";
  if (line.startsWith("\\")) return "text-muted-foreground italic";
  return "";
}
