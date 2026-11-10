import type { DataSource } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { usePanelRef } from "@/features/changes/hooks";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { Facts, PanelError, PanelLoading, RefSwitch, Section, Table } from "./common";

/** Data panel (plan 5.3): content sources as cards; `mode: data` sources also as a table. */
export function DataPanel({ siteId }: { siteId: string }) {
  const [ref] = usePanelRef(siteId);
  const { m } = useI18n();
  const data = useQuery({ queryKey: keys.panel(siteId, "data", ref), queryFn: () => api.data(siteId, ref) });

  let body: React.ReactNode;
  if (data.isPending) body = <PanelLoading />;
  else if (data.error) body = <PanelError error={data.error} />;
  else if (data.data.sources.length === 0)
    body = <p className="p-6 text-sm text-muted-foreground">{m.data.noSources}</p>;
  else
    body = (
      <div className="flex flex-col gap-4 p-4">
        {data.data.truncated && <p className="text-sm text-muted-foreground">{m.data.truncated}</p>}
        {data.data.sources.map((s) => (
          <SourceCard key={s.index} source={s} />
        ))}
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RefSwitch siteId={siteId} />
      <div className="min-h-0 flex-1 overflow-auto" data-testid="data-panel">
        {body}
      </div>
    </div>
  );
}

function SourceCard({ source: s }: { source: DataSource }) {
  const { m, t } = useI18n();
  const typeLabel =
    s.type === "markdown"
      ? m.data.markdown
      : s.type === "notion"
        ? m.data.notion
        : t(m.data.other, { type: s.sourceType ?? "?" });
  return (
    <article className="flex flex-col gap-3 rounded-lg border p-3" data-testid="data-source">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{s.name ?? `#${s.index + 1}`}</h3>
        <Badge>{typeLabel}</Badge>
        {s.mode && <Badge>{s.mode}</Badge>}
        {s.collection && <span className="text-xs text-muted-foreground">→ {s.collection}</span>}
      </header>
      {s.type === "markdown" && <MarkdownSource source={s} />}
      {s.type === "notion" && (
        <>
          <p className="text-xs text-muted-foreground">{m.data.notionNote}</p>
          <Facts
            rows={[
              [m.data.database, s.databaseId],
              [m.data.cacheMode, s.cacheMode],
            ]}
          />
        </>
      )}
    </article>
  );
}

function MarkdownSource({ source: s }: { source: Extract<DataSource, { type: "markdown" }> }) {
  const { m, t } = useI18n();
  // The table shows the most used fields; rare ones would only add empty columns.
  const columns = s.fields.slice(0, 8).map((f) => f.name);
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {s.dir && t(m.data.dir, { dir: s.dir })} · {t(m.data.fileCount, { count: s.fileCount })}
      </p>
      {s.fields.length > 0 && (
        <Section title={m.data.fields}>
          <div className="flex flex-wrap gap-1">
            {s.fields.map((f) => (
              <Badge key={f.name}>
                {f.name} <span className="text-muted-foreground">{f.count}</span>
              </Badge>
            ))}
          </div>
        </Section>
      )}
      {s.invalid.length > 0 && (
        <Section title={m.data.invalid}>
          <ul className="font-mono text-xs text-destructive">
            {s.invalid.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Section>
      )}
      {s.items.length > 0 && (
        <Section title={m.data.items}>
          {s.itemsTruncated && <p className="text-xs text-muted-foreground">{m.data.itemsTruncated}</p>}
          <Table
            head={[m.data.file, ...columns]}
            rows={s.items.map((item) => [
              <code key="f" className="text-xs">
                {item.file}
              </code>,
              ...columns.map((c) => cellText(item.data[c])),
            ])}
          />
        </Section>
      )}
    </>
  );
}

/** Front matter values as short text; nested values as compact JSON. */
function cellText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const json = JSON.stringify(v);
  return json.length > 120 ? `${json.slice(0, 120)}…` : json;
}
