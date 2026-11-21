import type { ContentDatabase, ContentSchemaProperty, ContentSortDirection } from "@bukitjalil/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api, type ContentEntryParams, keys } from "@/lib/api";
import { contentPagePath } from "@/lib/project";
import { NEW_PAGE, NOTION_QUERY } from "./hooks";

/** Types shown as columns of the list, in this order of preference. */
const COLUMN_TYPES = ["status", "select", "date", "multi_select", "checkbox", "number"];
const COLUMNS = 3;
/** Types Notion can sort by that read well as an order. */
const SORT_TYPES = new Set([
  "title",
  "rich_text",
  "number",
  "select",
  "status",
  "date",
  "checkbox",
  "url",
  "email",
  "phone_number",
  "created_time",
  "last_edited_time",
  "unique_id",
]);

export function columnsOf(properties: ContentSchemaProperty[]): ContentSchemaProperty[] {
  return COLUMN_TYPES.flatMap((type) => properties.filter((p) => p.type === type)).slice(0, COLUMNS);
}

/** The entries of one database (plan 5.6): searched by title, sorted, a page of 50 at a time. */
export function EntryList({
  sourceId,
  databaseId,
  database,
}: {
  sourceId: string;
  databaseId: string;
  database: ContentDatabase;
}) {
  const { m, t, errorOf } = useI18n();
  const [typed, setTyped] = useState("");
  const [params, setParams] = useState<ContentEntryParams>({ search: "", sort: "", direction: "" });
  const entries = useInfiniteQuery({
    queryKey: keys.contentEntries(sourceId, databaseId, params),
    queryFn: ({ pageParam }) => api.contentEntries(sourceId, databaseId, params, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    ...NOTION_QUERY,
  });
  const columns = columnsOf(database.properties);
  const sortable = database.properties.filter((p) => SORT_TYPES.has(p.type));
  const list = entries.data?.pages.flatMap((page) => page.entries) ?? [];
  const descending = params.direction === "descending" || (params.direction === "" && params.sort === "");
  const flip = () =>
    setParams({ ...params, direction: (descending ? "ascending" : "descending") satisfies ContentSortDirection });

  return (
    <div className="flex flex-col gap-3 p-4 text-sm" data-testid="content-database">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">{database.title}</h1>
        <Button size="sm" asChild>
          <Link to={contentPagePath(sourceId, databaseId, NEW_PAGE)} data-testid="content-new-entry">
            <Plus /> {m.content.newEntry}
          </Link>
        </Button>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-40 flex-1 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ ...params, search: typed.trim() });
          }}
        >
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={m.content.searchPlaceholder}
            aria-label={m.content.searchPlaceholder}
            maxLength={200}
            data-testid="content-search"
          />
          <Button type="submit" size="icon" variant="outline" aria-label={m.content.search} title={m.content.search}>
            <Search />
          </Button>
        </form>
        <div className="flex items-center gap-1">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm dark:bg-input/30"
            aria-label={m.content.sortLabel}
            value={params.sort}
            onChange={(e) => setParams({ ...params, sort: e.target.value, direction: "" })}
            data-testid="content-sort"
          >
            <option value="">{m.content.sortLastEdited}</option>
            {sortable.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <Button
            size="icon"
            variant="outline"
            onClick={flip}
            aria-label={descending ? m.content.descending : m.content.ascending}
            title={descending ? m.content.descending : m.content.ascending}
            data-testid="content-sort-direction"
          >
            {descending ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
          </Button>
        </div>
      </div>

      {entries.isPending && <p className="text-muted-foreground">{m.common.loading}</p>}
      {entries.error && (
        <p role="alert" className="text-destructive" data-testid="content-entries-error">
          {errorOf(entries.error)}
        </p>
      )}
      {entries.isSuccess && list.length === 0 && (
        <p className="text-muted-foreground" data-testid="content-no-entries">
          {params.search ? t(m.content.noMatches, { search: params.search }) : m.content.entriesEmpty}
        </p>
      )}
      {list.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border" data-testid="content-entries">
          {list.map((entry) => (
            <li key={entry.id}>
              <Link
                to={contentPagePath(sourceId, databaseId, entry.id)}
                className="flex flex-col gap-1 px-3 py-2 hover:bg-accent/60"
                data-testid="content-entry"
              >
                <span className={`truncate font-medium ${entry.title ? "" : "text-muted-foreground"}`}>
                  {entry.title || m.content.untitled}
                </span>
                {columns.some((c) => entry.cells[c.name]) && (
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {columns.map((c) =>
                      entry.cells[c.name] ? (
                        <span key={c.name} className="min-w-0 truncate" title={c.name}>
                          {entry.cells[c.name]}
                        </span>
                      ) : null,
                    )}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {entries.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          disabled={entries.isFetchingNextPage}
          onClick={() => void entries.fetchNextPage()}
          data-testid="content-load-more"
        >
          {entries.isFetchingNextPage ? m.common.loading : m.content.loadMore}
        </Button>
      )}
    </div>
  );
}
