import type { ContentDatabase, ContentPage, ContentValue } from "@bukitjalil/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2, Save } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { ApiRequestError, api, keys } from "@/lib/api";
import { contentDatabasePath, contentPagePath } from "@/lib/project";
import { draftKey, useDraft } from "./draft";
import { emptyValue, NEW_PAGE, useContentPage } from "./hooks";

/**
 * The open entry in the middle column (plan 5.6): its title, and the save that writes the title and the
 * properties edited in the right column to Notion. The body is edited in Notion until C2.
 */
export function PageEditor({
  sourceId,
  databaseId,
  pageId,
  database,
}: {
  sourceId: string;
  databaseId: string;
  pageId: string;
  database: ContentDatabase;
}) {
  const { m, errorOf } = useI18n();
  const isNew = pageId === NEW_PAGE;
  const page = useContentPage(sourceId, databaseId, pageId);
  const draft = useDraft(draftKey(sourceId, databaseId, pageId));
  const save = useSavePage(sourceId, databaseId, pageId, page.data, draft);

  if (!isNew && page.isPending) return <p className="p-6 text-sm text-muted-foreground">{m.common.loading}</p>;
  const back = (
    <Button size="sm" variant="ghost" asChild>
      <Link to={contentDatabasePath(sourceId, databaseId)} data-testid="content-back">
        <ArrowLeft /> {m.content.backToList}
      </Link>
    </Button>
  );
  if (!isNew && page.error) {
    return (
      <div className="flex flex-col items-start gap-3 p-4 text-sm">
        {back}
        <p role="alert" className="text-destructive" data-testid="content-page-error">
          {errorOf(page.error)}
        </p>
      </div>
    );
  }

  const titleSchema = database.properties.find((p) => p.type === "title");
  const titleProperty = isNew ? undefined : page.data?.properties.find((p) => p.type === "title");
  const titleName = titleProperty?.name ?? titleSchema?.name;
  const savedTitle = titleProperty?.value ?? (titleSchema ? emptyValue(titleSchema) : null);
  const title = (titleName && draft.changes[titleName]) || savedTitle;
  const conflict = save.error instanceof ApiRequestError && save.error.code === "content.conflict";

  return (
    <div className="flex flex-col gap-3 p-4 text-sm" data-testid="content-page">
      <header className="flex flex-wrap items-center gap-2">
        {back}
        <span className="flex-1" />
        {page.data?.url && (
          <Button size="sm" variant="ghost" asChild>
            <a href={page.data.url} target="_blank" rel="noreferrer noopener" data-testid="content-open-notion">
              <ExternalLink /> {m.content.openInNotion}
            </a>
          </Button>
        )}
        <Button
          size="sm"
          disabled={(!isNew && !draft.dirty) || save.isPending}
          onClick={() => save.mutate()}
          data-testid="content-save"
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          {isNew
            ? save.isPending
              ? m.content.creating
              : m.content.create
            : save.isPending
              ? m.content.saving
              : m.content.save}
        </Button>
      </header>
      {title?.type === "title" && titleName && (
        <input
          className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground hover:border-border focus-visible:border-ring"
          aria-label={m.content.titleLabel}
          placeholder={m.content.untitled}
          value={title.text}
          maxLength={2000}
          onChange={(e) => draft.set(titleName, { type: "title", text: e.target.value }, savedTitle)}
          data-testid="content-title"
        />
      )}
      {titleProperty?.formatted && <p className="text-xs text-muted-foreground">{m.content.plainTextOnly}</p>}
      {save.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-destructive"
          data-testid="content-save-error"
        >
          <span>{errorOf(save.error)}</span>
          {conflict && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                draft.clear();
                save.reset();
                void page.refetch();
              }}
              data-testid="content-reload"
            >
              {m.content.reload}
            </Button>
          )}
        </div>
      )}
      {save.isSuccess && !draft.dirty && !isNew && (
        <p role="status" className="text-muted-foreground" data-testid="content-saved">
          {m.content.saved}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{m.content.saveNotice}</p>
      {!isNew && (
        <p className="text-muted-foreground" data-testid="content-body-in-notion">
          {m.content.bodyInNotion}
        </p>
      )}
    </div>
  );
}

/** Save the changed properties, or create the page: either way straight to Notion. */
function useSavePage(
  sourceId: string,
  databaseId: string,
  pageId: string,
  page: ContentPage | undefined,
  draft: { changes: Readonly<Record<string, ContentValue>>; clear: () => void },
) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () =>
      pageId === NEW_PAGE
        ? api.createContentPage(sourceId, databaseId, { properties: { ...draft.changes } })
        : api.updateContentPage(sourceId, databaseId, pageId, {
            lastEditedTime: page?.lastEditedTime ?? "",
            properties: { ...draft.changes },
          }),
    onSuccess: (saved) => {
      draft.clear();
      void queryClient.invalidateQueries({ queryKey: keys.contentEntries(sourceId, databaseId) });
      if (pageId === NEW_PAGE) {
        queryClient.setQueryData(keys.contentPage(sourceId, databaseId, saved.id), saved);
        navigate(contentPagePath(sourceId, databaseId, saved.id), { replace: true });
      } else {
        queryClient.setQueryData(keys.contentPage(sourceId, databaseId, pageId), saved);
      }
    },
  });
}
