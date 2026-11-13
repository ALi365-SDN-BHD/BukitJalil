import type { ChangedFile } from "@bukitjalil/shared";
import { useI18n } from "@/i18n";
import { statusMark, statusTone } from "./hooks";

/**
 * Changed files with their status and line counts; clicking one opens its diff. With `include`, each file
 * has a box that says whether applying takes it (plan 7.5).
 */
export function ChangedFileList({
  files,
  selected,
  onSelect,
  compact = false,
  include,
}: {
  files: ChangedFile[];
  selected?: string | null;
  onSelect: (path: string) => void;
  compact?: boolean;
  include?: { on: (path: string) => boolean; set: (path: string, on: boolean) => void };
}) {
  const { m } = useI18n();
  return (
    <ul className={compact ? "text-xs" : "text-sm"} data-testid="changed-files">
      {files.map((f) => (
        <li key={f.path} className="flex items-center gap-1">
          {include && (
            <input
              type="checkbox"
              className="ml-1 shrink-0"
              checked={include.on(f.path)}
              onChange={(e) => include.set(f.path, e.target.checked)}
              aria-label={`${m.changes.includeFile}: ${f.path}`}
              title={m.changes.includeFile}
              data-testid="include-file"
            />
          )}
          <button
            type="button"
            onClick={() => onSelect(f.path)}
            aria-current={selected === f.path ? "true" : undefined}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-0.5 text-left ${selected === f.path ? "bg-accent" : "hover:bg-accent/60"} ${include && !include.on(f.path) ? "opacity-50" : ""}`}
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
