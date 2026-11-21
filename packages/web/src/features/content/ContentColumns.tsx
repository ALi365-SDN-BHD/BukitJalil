import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useParams } from "react-router";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";

/**
 * Content management's middle column (plan 5.6): the entries of the open database (C1); without one, what
 * the mode is for.
 */
export function ContentMain() {
  const { m } = useI18n();
  const { sourceId = null, databaseId = null } = useParams();
  const sources = useQuery({ queryKey: keys.dataSources, queryFn: api.dataSources });
  // The list the sidebar already read; this column does not call Notion itself.
  const databases = useQuery({
    queryKey: keys.notionDatabases(sourceId ?? ""),
    queryFn: () => api.notionDatabases(sourceId ?? ""),
    enabled: false,
  });

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
  const title = databases.data?.databases.find((x) => x.id === databaseId)?.title;
  return (
    <div className="flex flex-col gap-2 p-6 text-sm" data-testid="content-database">
      {title && <h1 className="text-xl font-semibold tracking-tight">{title}</h1>}
      <p className="text-muted-foreground">{m.content.entriesEmpty}</p>
    </div>
  );
}

/** Content management's right column (plan 5.6): the open entry's properties (C1). */
export function ContentProperties() {
  const { m } = useI18n();
  return (
    <div
      className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground"
      data-testid="content-properties"
    >
      {m.content.propertiesEmpty}
    </div>
  );
}
