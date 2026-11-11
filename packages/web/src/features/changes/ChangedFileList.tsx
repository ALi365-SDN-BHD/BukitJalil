import type { ChangedFile } from "@bukitjalil/shared";
import { useI18n } from "@/i18n";
import { statusMark, statusTone } from "./hooks";

/** Changed files with their status and line counts; clicking one opens its diff. */
export function ChangedFileList({
  files,
  selected,
  onSelect,
  compact = false,
}: {
  files: ChangedFile[];
  selected?: string | null;
  onSelect: (path: string) => void;
  compact?: boolean;
}) {
  const { m } = useI18n();
  return (
    <ul className={compact ? "text-xs" : "text-sm"} data-testid="changed-files">
      {files.map((f) => (
        <li key={f.path}>
          <button
            type="button"
            onClick={() => onSelect(f.path)}
            aria-current={selected === f.path ? "true" : undefined}
            className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left ${selected === f.path ? "bg-accent" : "hover:bg-accent/60"}`}
          >
            <span
              className={`w-3 shrink-0 font-mono font-medium ${statusTone[f.status]}`}
              title={m.changes.status[f.status]}
            >
              {statusMark[f.status]}
            </span>
            <span className="sr-only">{m.changes.status[f.status]}</span>
            <code className="min-w-0 flex-1 truncate" title={f.path}>
              {f.path}
            </code>
            {f.additions !== null && f.deletions !== null && (
              <span className="shrink-0 font-mono text-muted-foreground">
                <span className="text-emerald-700 dark:text-emerald-400">+{f.additions}</span>{" "}
                <span className="text-destructive">−{f.deletions}</span>
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
