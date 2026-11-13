import type { DataSource, PanelRef } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePanelRef } from "@/features/changes/hooks";
import { settingsSelectClass } from "@/features/settings/SettingsLayout";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { formatTime } from "@/lib/format";
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
        {data.data.sources.some((s) => s.type === "notion") && <NotionBinding siteId={siteId} />}
        {data.data.sources.map((s) => (
          <SourceCard key={s.index} siteId={siteId} refName={ref} source={s} />
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

/**
 * The saved Notion data source whose token main builds use. Nothing picks one for the user: an imported
 * site's site.yaml can name any database the token reads, so binding is an explicit choice.
 */
function NotionBinding({ siteId }: { siteId: string }) {
  const { m, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const site = useQuery({ queryKey: keys.site(siteId), queryFn: () => api.site(siteId) });
  const sources = useQuery({ queryKey: keys.dataSources, queryFn: api.dataSources });
  const bind = useMutation({
    mutationFn: (dataSourceId: string | null) => api.setNotionSource(siteId, { dataSourceId }),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.site(siteId), updated);
      void queryClient.invalidateQueries({ queryKey: keys.sites });
      void queryClient.invalidateQueries({ queryKey: keys.dataSources });
      // Fields read with the previous token no longer say what this one can read.
      queryClient.removeQueries({ queryKey: ["notion-fields", siteId] });
    },
  });
  if (site.isPending || sources.isPending) return null;
  if (site.error || sources.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorOf(site.error ?? sources.error)}
      </p>
    );
  const bound = site.data.notionDataSourceId;
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-3" data-testid="notion-binding">
      <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {m.data.notionBinding}
        <select
          className={settingsSelectClass}
          value={bound ?? ""}
          disabled={bind.isPending}
          onChange={(e) => bind.mutate(e.target.value || null)}
          data-testid="notion-binding-select"
        >
          <option value="">{m.data.notionUnbound}</option>
          {bound && !sources.data.some((source) => source.id === bound) && <option value={bound}>{bound}</option>}
          {sources.data.map((source) => (
            <option key={source.id} value={source.id}>
              {source.tokenLast4 ? `${source.name} (…${source.tokenLast4})` : source.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        {sources.data.length === 0 ? m.data.notionNoSources : bound ? m.data.notionBoundHint : m.data.notionUnboundHint}
      </p>
      {bind.error && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(bind.error)}
        </p>
      )}
    </section>
  );
}

function SourceCard({ siteId, refName, source: s }: { siteId: string; refName: PanelRef; source: DataSource }) {
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
          {refName === "main" ? (
            s.databaseId && <NotionFields siteId={siteId} index={s.index} />
          ) : (
            <p className="text-xs text-muted-foreground">{m.data.fieldsMainOnly}</p>
          )}
        </>
      )}
    </article>
  );
}

/**
 * A Notion source's database fields (plan 5.4), read only when the user asks: Notion is called with the
 * bound token for the database on the default branch. Kept for the page's life, read again on request.
 */
function NotionFields({ siteId, index }: { siteId: string; index: number }) {
  const { m, t, locale, errorOf } = useI18n();
  const fields = useQuery({
    queryKey: ["notion-fields", siteId, index],
    queryFn: () => api.notionSource(siteId, index),
    enabled: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <div className="flex flex-col gap-2" data-testid="notion-fields">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={fields.isFetching}
          onClick={() => void fields.refetch()}
          data-testid="notion-read-fields"
        >
          {fields.isFetching ? m.data.readingFields : fields.data ? m.data.rereadFields : m.data.readFields}
        </Button>
        <span className="text-xs text-muted-foreground">{m.data.pagesLater}</span>
      </div>
      {fields.error && !fields.isFetching && (
        <p role="alert" className="text-xs text-destructive" data-testid="notion-fields-error">
          {errorOf(fields.error)}
        </p>
      )}
      {fields.data && (
        <Section title={t(m.data.fieldsTitle, { title: fields.data.title ?? fields.data.databaseId })}>
          <div className="flex flex-wrap gap-1" data-testid="notion-field-list">
            {fields.data.properties.map((p) => (
              <Badge key={p.name}>
                {p.name} <span className="text-muted-foreground">{p.type}</span>
              </Badge>
            ))}
          </div>
          {fields.data.propertiesTruncated && <p className="text-xs text-muted-foreground">{m.data.fieldsMore}</p>}
          <p className="text-xs text-muted-foreground">
            {t(m.data.fieldsRead, { time: formatTime(fields.data.readAt, locale) })}
          </p>
        </Section>
      )}
    </div>
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
          {(s.items.length > 1 || s.itemsTruncated) && (
            <p className="text-xs text-muted-foreground">{m.data.itemsDemo}</p>
          )}
          <Table
            head={[m.data.file, ...columns]}
            rows={s.items.slice(0, 1).map((item) => [
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
