import type { ContentDatabase } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Link } from "react-router";
import { BuildButton } from "@/features/builds/builds";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { EntryList } from "./EntryList";
import { useContentDatabase, useContentParams } from "./hooks";
import { PageEditor } from "./PageEditor";
import { PropertyForm } from "./PropertyForm";

/**
 * Content management's middle column (plan 5.6): the open database's entries, or the open entry; without a
 * database, what the mode is for.
 */
export function ContentMain() {
  const { m, errorOf } = useI18n();
  const { sourceId, databaseId, pageId } = useContentParams();
  const sources = useQuery({ queryKey: keys.dataSources, queryFn: api.dataSources });
  // A remembered place whose data source was deleted since falls back to the welcome.
  const gone = sources.data !== undefined && !sources.data.some((x) => x.id === sourceId);
  if (sourceId === null || databaseId === null || gone) {
    return (
      <div className="flex flex-col gap-4 p-6 text-sm" data-testid="content-welcome">
        <header className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <FileText className="size-5" /> {m.mode.content}
          </h1>
          <p className="text-muted-foreground">{m.content.welcome}</p>
        </header>
        {sources.data && sources.data.length > 0 && <p className="text-muted-foreground">{m.content.pickDatabase}</p>}
      </div>
    );
  }
  return (
    <WithDatabase sourceId={sourceId} databaseId={databaseId} error={(err) => errorOf(err)}>
      {(database) =>
        pageId ? (
          <PageEditor key={pageId} sourceId={sourceId} databaseId={databaseId} pageId={pageId} database={database} />
        ) : (
          <EntryList
            key={`${sourceId}/${databaseId}`}
            sourceId={sourceId}
            databaseId={databaseId}
            database={database}
          />
        )
      }
    </WithDatabase>
  );
}

/** Content management's right column (plan 5.6): the open entry's properties, or the database's fields. */
export function ContentProperties() {
  const { m } = useI18n();
  const { sourceId, databaseId, pageId } = useContentParams();
  const sources = useQuery({ queryKey: keys.dataSources, queryFn: api.dataSources });
  const gone = sources.data !== undefined && !sources.data.some((x) => x.id === sourceId);
  if (sourceId === null || databaseId === null || gone) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground"
        data-testid="content-properties"
      >
        {m.content.propertiesEmpty}
      </div>
    );
  }
  return (
    // The middle column shows why the database could not be read.
    <WithDatabase sourceId={sourceId} databaseId={databaseId} error={() => null}>
      {(database) =>
        pageId ? (
          <PropertyForm key={pageId} sourceId={sourceId} databaseId={databaseId} pageId={pageId} database={database} />
        ) : (
          <DatabaseInfo sourceId={sourceId} database={database} />
        )
      }
    </WithDatabase>
  );
}

function WithDatabase({
  sourceId,
  databaseId,
  error,
  children,
}: {
  sourceId: string;
  databaseId: string;
  error: (err: unknown) => React.ReactNode;
  children: (database: ContentDatabase) => React.ReactNode;
}) {
  const { m } = useI18n();
  const database = useContentDatabase(sourceId, databaseId);
  if (database.isPending) return <p className="p-6 text-sm text-muted-foreground">{m.common.loading}</p>;
  if (database.error) {
    const text = error(database.error);
    return text ? (
      <p role="alert" className="p-6 text-sm text-destructive" data-testid="content-database-error">
        {text}
      </p>
    ) : null;
  }
  return children(database.data);
}

/** The database's fields, and the sites whose full build reads this data source. */
function DatabaseInfo({ sourceId, database }: { sourceId: string; database: ContentDatabase }) {
  const { m } = useI18n();
  const sites = useQuery({ queryKey: keys.sites, queryFn: api.sites });
  const using = sites.data?.filter((s) => s.notionDataSourceId === sourceId) ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 text-sm" data-testid="content-database-info">
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{m.content.usedBy}</h2>
        {sites.isSuccess && using.length === 0 && <p className="text-muted-foreground">{m.content.usedByNone}</p>}
        {using.length > 0 && (
          <>
            <ul className="flex flex-col divide-y rounded-md border" data-testid="content-used-by">
              {using.map((site) => (
                <li
                  key={site.id}
                  className="flex flex-wrap items-center gap-2 px-3 py-2"
                  data-testid={`content-site-${site.id}`}
                >
                  <Link to={`/sites/${site.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    {site.name}
                  </Link>
                  <BuildButton project={site.id} disabled={!!site.readOnly} />
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{m.content.usedByHint}</p>
          </>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{m.content.fields}</h2>
        <ul className="flex flex-col gap-1" data-testid="content-fields">
          {database.properties.map((p) => (
            <li key={p.name} className="flex items-baseline gap-2">
              <span className="min-w-0 truncate">{p.name}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.type}</span>
              {!p.editable && <span className="shrink-0 text-xs text-muted-foreground">{m.content.readOnly}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
