import { CONTENT_BODY_MAX, type ContentDatabase, type ContentPage } from "@bukitjalil/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2, Save } from "lucide-react";
import { useId } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { ApiRequestError, api, keys } from "@/lib/api";
import { contentDatabasePath, contentPagePath } from "@/lib/project";
import { draftKey, useDraft } from "./draft";
import { emptyValue, NEW_PAGE, useContentBody, useContentPage } from "./hooks";

/**
 * The open entry in the middle column (plan 5.6): its title and body, and the save that writes them and the
 * properties edited in the right column to Notion.
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
  const body = useContentBody(sourceId, databaseId, pageId);
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
                void body.refetch();
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
      <BodyField
        isNew={isNew}
        body={body}
        value={draft.body}
        onChange={(value) => draft.setBody(value, body.data?.markdown ?? "")}
        notionUrl={page.data?.url ?? null}
      />
    </div>
  );
}

/** The body: Markdown to edit, or why it cannot be edited here. */
function BodyField({
  isNew,
  body,
  value,
  onChange,
  notionUrl,
}: {
  isNew: boolean;
  body: ReturnType<typeof useContentBody>;
  value: string | null;
  onChange: (value: string) => void;
  notionUrl: string | null;
}) {
  const { m, t, errorOf } = useI18n();
  const id = useId();
  if (!isNew && body.isPending) return <p className="text-muted-foreground">{m.common.loading}</p>;
  if (!isNew && body.error) {
    return (
      <p role="alert" className="text-destructive" data-testid="content-body-error">
        {errorOf(body.error)}
      </p>
    );
  }
  if (body.data && !body.data.editable) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border p-3" data-testid="content-body-readonly">
        <p className="text-muted-foreground">
          {t(m.content.bodyReadOnly, { types: body.data.unsupported.join(", ") })}
        </p>
        {notionUrl && (
          <Button size="sm" variant="outline" asChild>
            <a href={notionUrl} target="_blank" rel="noreferrer noopener">
              <ExternalLink /> {m.content.openInNotion}
            </a>
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium">
        {m.content.bodyLabel}
      </label>
      <textarea
        id={id}
        className="min-h-80 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        value={value ?? body.data?.markdown ?? ""}
        maxLength={CONTENT_BODY_MAX}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        data-testid="content-body"
      />
      <p className="text-xs text-muted-foreground">{m.content.bodyHint}</p>
    </div>
  );
}

/**
 * Save the body, then the changed properties, or create the page with both: straight to Notion. The body
 * goes first and its new edit time is what the property save checks, so the two saves do not conflict.
 * Each part leaves the draft once it is written, so a failure in the second keeps only what was not saved.
 */
function useSavePage(
  sourceId: string,
  databaseId: string,
  pageId: string,
  page: ContentPage | undefined,
  draft: ReturnType<typeof useDraft>,
) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pageKey = keys.contentPage(sourceId, databaseId, pageId);
  return useMutation({
    mutationFn: async () => {
      if (pageId === NEW_PAGE) {
        const created = await api.createContentPage(sourceId, databaseId, {
          properties: { ...draft.changes },
          ...(draft.body ? { markdown: draft.body } : {}),
        });
        draft.clear();
        queryClient.setQueryData(keys.contentPage(sourceId, databaseId, created.id), created);
        navigate(contentPagePath(sourceId, databaseId, created.id), { replace: true });
        return;
      }
      let edited = page?.lastEditedTime ?? "";
      if (draft.body !== null) {
        const saved = await api.saveContentBody(sourceId, databaseId, pageId, {
          lastEditedTime: edited,
          markdown: draft.body,
        });
        edited = saved.lastEditedTime;
        queryClient.setQueryData(keys.contentBody(sourceId, databaseId, pageId), saved);
        queryClient.setQueryData<ContentPage>(pageKey, (old) => (old ? { ...old, lastEditedTime: edited } : old));
        draft.clearBody();
      }
      if (draft.propertiesDirty) {
        const saved = await api.updateContentPage(sourceId, databaseId, pageId, {
          lastEditedTime: edited,
          properties: { ...draft.changes },
        });
        queryClient.setQueryData(pageKey, saved);
        draft.clearProperties();
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.contentEntries(sourceId, databaseId) }),
  });
}
