import type { FileDiff } from "@bukitjalil/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import { PanelError, PanelLoading } from "@/features/panels/common";
import { useI18n } from "@/i18n";

/** One file's diff (plan 10.2): its path, then the patch, or why there is none to show. */
export function FileDiffView({ path, diff }: { path: string; diff: UseQueryResult<FileDiff> }) {
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
      <PatchView patch={diff.data.patch ?? ""} />
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
function PatchView({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  const start = lines.findIndex((l) => l.startsWith("@@"));
  const body = (start >= 0 ? lines.slice(start) : lines).filter((l, i, all) => !(l === "" && i === all.length - 1));
  return (
    <pre className="min-h-0 flex-1 overflow-auto py-1 font-mono text-xs leading-5" data-testid="diff-patch">
      {body.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines of a fixed patch
        <div key={i} className={`px-3 whitespace-pre ${lineTone(line)}`}>
          {line || " "}
        </div>
      ))}
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
