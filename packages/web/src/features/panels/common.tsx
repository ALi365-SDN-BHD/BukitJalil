import { useI18n } from "@/i18n";

export function PanelLoading() {
  const { m } = useI18n();
  return <p className="p-6 text-sm text-muted-foreground">{m.common.loading}</p>;
}

export function PanelError({ error }: { error: unknown }) {
  const { errorOf } = useI18n();
  return (
    <p role="alert" className="p-6 text-sm text-destructive">
      {errorOf(error)}
    </p>
  );
}

/**
 * Version switch at the top of the read-only panels (plan 10.2). Only the main version exists until
 * change sets arrive in M4; the second button shows where it will be.
 */
export function RefSwitch() {
  const { m } = useI18n();
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2 text-xs">
      <button type="button" className="rounded bg-accent px-2 py-0.5 font-medium" aria-pressed="true">
        {m.files.main}
      </button>
      <button
        type="button"
        disabled
        className="cursor-not-allowed rounded px-2 py-0.5 text-muted-foreground/60"
        title={m.files.changeLater}
      >
        {m.files.change}
      </button>
    </div>
  );
}

/** A label/value grid for summaries. */
export function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  const { m } = useI18n();
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">
            {value === null || value === undefined || value === "" ? (
              <span className="text-muted-foreground">{m.common.none}</span>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

/** A small table; empty cells show a dash. */
export function Table({ head, rows }: { head: string[]; rows: (React.ReactNode | null)[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-2 py-1 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are a fixed snapshot
            <tr key={i} className="border-t align-top">
              {row.map((cell, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are fixed
                <td key={j} className="px-2 py-1">
                  {cell === null || cell === undefined || cell === "" ? (
                    <span className="text-muted-foreground">–</span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
