import type { NotionConfigChange } from "@bukitjalil/shared";
import { useI18n } from "@/i18n";

/**
 * The Notion sources a change set adds, removes or points elsewhere (plan 5.4): once applied, main builds
 * read those databases with the bound token, so the review calls them out.
 */
export function NotionChangesNote({ changes }: { changes: NotionConfigChange[] | undefined }) {
  const { m, t } = useI18n();
  if (!changes || changes.length === 0) return null;
  const n = m.notion;
  const id = (v: string | null | undefined) => v ?? n.none;
  return (
    <div
      role="note"
      className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
      data-testid="notion-changes"
    >
      <p className="font-medium">{n.changesTitle}</p>
      <ul className="flex flex-col gap-0.5">
        {changes.map((c) => (
          <li key={`${c.change}:${c.source}`}>
            {c.change === "unreadable"
              ? n.unreadable
              : c.change === "added"
                ? t(n.added, { source: c.source, after: id(c.databaseId?.after) })
                : c.change === "removed"
                  ? t(n.removed, { source: c.source, before: id(c.databaseId?.before) })
                  : [
                      c.databaseId &&
                        t(n.changed, {
                          source: c.source,
                          before: id(c.databaseId.before),
                          after: id(c.databaseId.after),
                        }),
                      c.keys.length > 0 && t(n.keys, { source: c.source, keys: c.keys.join(", ") }),
                    ]
                      .filter(Boolean)
                      .join("; ")}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">{n.changesHint}</p>
    </div>
  );
}
