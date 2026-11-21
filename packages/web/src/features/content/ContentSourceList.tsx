import type { SavedDataSource } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Database, Plus } from "lucide-react";
import { useState } from "react";
import { NavLink, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { useOpenSettings } from "@/features/settings/useOpenSettings";
import { SidebarFooter } from "@/features/sites/SiteList";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { contentDatabasePath } from "@/lib/project";

/**
 * Content management's sidebar (plan 5.6): every saved Notion data source; opening one lists the databases
 * its token can access. Only the local list is read on entering the mode: Notion is called when a source is
 * opened (or, coming back to a database, for the source it belongs to).
 */
export function ContentSourceList() {
  const { m, errorOf } = useI18n();
  const openSettings = useOpenSettings();
  const sources = useQuery({ queryKey: keys.dataSources, queryFn: api.dataSources });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-1 border-b p-2">
        <Button size="sm" variant="outline" onClick={() => openSettings("data")} data-testid="content-add-source">
          <Plus /> {m.content.addSource}
        </Button>
      </div>
      <nav
        className="min-h-0 flex-1 overflow-y-auto p-2 text-sm"
        aria-label={m.content.sources}
        data-testid="content-source-list"
      >
        {sources.isPending && <p className="p-2 text-muted-foreground">{m.common.loading}</p>}
        {sources.error && (
          <p className="p-2 text-destructive" role="alert">
            {errorOf(sources.error)}
          </p>
        )}
        {sources.data?.length === 0 && (
          <p className="p-2 text-muted-foreground" data-testid="content-no-sources">
            {m.content.noSources}
          </p>
        )}
        <ul className="flex flex-col gap-0.5">
          {sources.data?.map((source) => (
            <SourceItem key={source.id} source={source} />
          ))}
        </ul>
      </nav>
      <SidebarFooter />
    </div>
  );
}

function SourceItem({ source }: { source: SavedDataSource }) {
  const { m, t } = useI18n();
  const { sourceId } = useParams();
  const selected = sourceId === source.id;
  // Starts open only for the source of the database in the URL; otherwise the user opens it.
  const [open, setOpen] = useState(selected);
  const label = t(open ? m.content.hideDatabases : m.content.showDatabases, { name: source.name });
  return (
    <li className="flex flex-col" data-testid={`content-source-${source.id}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
        className={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-2 text-left text-base ${
          selected ? "font-medium" : ""
        } hover:bg-accent/60`}
      >
        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{source.name}</span>
        {!source.hasToken && <span className="shrink-0 text-xs text-muted-foreground">{m.content.noToken}</span>}
      </button>
      {open && <DatabaseList sourceId={source.id} />}
    </li>
  );
}

function DatabaseList({ sourceId }: { sourceId: string }) {
  const { m, errorOf } = useI18n();
  const { databaseId } = useParams();
  const databases = useQuery({
    queryKey: keys.notionDatabases(sourceId),
    queryFn: () => api.notionDatabases(sourceId),
    // A missing token or offline mode does not fix itself by retrying.
    retry: false,
  });
  if (databases.isPending)
    return <p className="py-1 pl-8 text-xs text-muted-foreground">{m.content.databasesLoading}</p>;
  if (databases.error) {
    return (
      <p className="py-1 pr-2 pl-8 text-xs text-destructive" role="alert" data-testid="content-databases-error">
        {errorOf(databases.error)}
      </p>
    );
  }
  if (databases.data.databases.length === 0) {
    return <p className="py-1 pr-2 pl-8 text-xs text-muted-foreground">{m.content.noDatabases}</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5 py-0.5" data-testid={`content-databases-${sourceId}`}>
      {databases.data.databases.map((db) => {
        const selected = databaseId === db.id;
        return (
          <li key={db.id}>
            <NavLink
              to={contentDatabasePath(sourceId, db.id)}
              data-testid={`content-database-${db.id}`}
              aria-current={selected ? "page" : undefined}
              className={`flex min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 pl-7 ${
                selected ? "bg-foreground/10 font-medium" : "hover:bg-accent/60"
              }`}
            >
              <Database className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{db.title}</span>
            </NavLink>
          </li>
        );
      })}
    </ul>
  );
}
