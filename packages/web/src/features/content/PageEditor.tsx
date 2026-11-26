import type { ContentBlock, ContentBody, ContentDatabase, ContentPage } from "@bukitjalil/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2, Save } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { ApiRequestError, api, keys } from "@/lib/api";
import { contentDatabasePath, contentPagePath } from "@/lib/project";
import { sameBlocks } from "./blocks";
import { changeOf, draftKey, saveKey, useDraft } from "./draft";
import { emptyValue, NEW_PAGE, useContentBody, useContentPage } from "./hooks";

// The block editor loads on first use, keeping it out of the main chunk.
const BodyEditor = lazy(() => import("./BodyEditor"));

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
  const title = (titleName && changeOf(draft.changes, titleName)) || savedTitle;
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
          disabled={(!isNew && !draft.dirty) || draft.problem !== null || save.isPending}
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
          disabled={save.isPending}
          onChange={(e) =>
            draft.set(
              titleName,
              { type: "title", text: e.target.value },
              savedTitle,
              page.data?.lastEditedTime ?? "",
              titleProperty?.revision,
            )
          }
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
      <BodyField isNew={isNew} body={body} draft={draft} saving={save.isPending} notionUrl={page.data?.url ?? null} />
    </div>
  );
}

/** The body: blocks to edit, or why they cannot be edited here. */
function BodyField({
  isNew,
  body,
  draft,
  saving,
  notionUrl,
}: {
  isNew: boolean;
  body: ReturnType<typeof useContentBody>;
  draft: ReturnType<typeof useDraft>;
  /** Read-only while a save runs, so nothing typed meanwhile is lost when it ends. */
  saving: boolean;
  notionUrl: string | null;
}) {
  const { locale, m, t, errorOf } = useI18n();
  const saved = body.data?.blocks ?? EMPTY;
  // What the editor shows last, to tell a body read again (a save, a reload) from the one it already has, and
  // the addresses its images in Notion were loaded with.
  const shown = useRef<readonly ContentBlock[] | null>(null);
  const shownUrls = useRef<ReadonlyMap<string, string>>(new Map());
  const [mount, setMount] = useState({ at: body.dataUpdatedAt, key: 0 });
  if (body.dataUpdatedAt !== mount.at && draft.problem === null) {
    // Signed addresses expire: new ones are loaded even over a draft, which the editor is loaded from.
    const fresh = [...imageUrls(saved)].some(
      ([id, url]) => shownUrls.current.get(id) !== url && shownUrls.current.has(id),
    );
    if (fresh || draft.body === null) {
      const changed = draft.body === null && shown.current !== null && !sameBlocks(shown.current, saved);
      setMount({ at: body.dataUpdatedAt, key: fresh || changed ? mount.key + 1 : mount.key });
    }
  }
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
          {t(m.content.bodyReadOnly, {
            types: new Intl.ListFormat(locale).format(
              body.data.unsupported.map(
                (code) =>
                  (Object.hasOwn(m.content.readOnlyReasons, code) ? m.content.readOnlyReasons[code] : undefined) ??
                  t(m.content.readOnlyOther, { code }),
              ),
            ),
          })}
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
  const base = body.data?.lastEditedTime ?? "";
  const initial = withShownImages(draft.body ?? saved, saved);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium">{m.content.bodyLabel}</span>
      <Suspense fallback={<p className="text-muted-foreground">{m.common.loading}</p>}>
        <BodyEditor
          key={mount.key}
          blocks={initial}
          restore={draft.problem ? draft.unsaved : null}
          editable={!saving}
          onLoad={() => {
            shown.current = draft.body ?? saved;
            shownUrls.current = imageUrls(initial);
          }}
          onChange={(change) => {
            if ("problem" in change) return draft.setProblem(change.problem, change.unsaved, base);
            shown.current = change.blocks;
            draft.setBody(change.blocks, saved, base);
          }}
        />
      </Suspense>
      {draft.problem && (
        <p role="alert" className="text-destructive" data-testid="content-body-problem">
          {m.content.bodyProblems[draft.problem]}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{m.content.bodyHint}</p>
    </div>
  );
}

const EMPTY: readonly ContentBlock[] = [];

/** The addresses images in Notion are shown with, by id. */
const imageUrls = (blocks: readonly ContentBlock[]) =>
  new Map(blocks.flatMap((b) => (b.type === "notion_image" && b.url ? [[b.id, b.url] as const] : [])));

/** A draft body with the addresses its images in Notion are shown with, which a draft does not keep. */
function withShownImages(blocks: readonly ContentBlock[], saved: readonly ContentBlock[]): ContentBlock[] {
  const urls = imageUrls(saved);
  return blocks.map((b) => {
    const url = b.type === "notion_image" && !b.url ? urls.get(b.id) : undefined;
    return url ? { ...b, url } : b;
  });
}

/**
 * Save the body, then the changed properties, or create the page with both: straight to Notion. The first
 * save checks the edit time the draft was started on; the body's new edit time is what the property save
 * checks, so the two saves do not conflict. Each part leaves the draft once it is written, so a failure in the
 * second keeps only what was not saved, and what is typed while saving stays in the draft.
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
  const bodyKey = keys.contentBody(sourceId, databaseId, pageId);
  return useMutation({
    mutationKey: saveKey(draftKey(sourceId, databaseId, pageId)),
    mutationFn: async () => {
      if (pageId === NEW_PAGE) {
        const created = await api.createContentPage(sourceId, databaseId, {
          properties: { ...draft.changes },
          ...(draft.body ? { blocks: [...draft.body] } : {}),
        });
        draft.clear();
        queryClient.setQueryData(keys.contentPage(sourceId, databaseId, created.id), created);
        navigate(contentPagePath(sourceId, databaseId, created.id), { replace: true });
        return;
      }
      const sentBody = draft.body;
      const sentChanges = { ...draft.changes };
      let edited = draft.base || page?.lastEditedTime || "";
      if (sentBody !== null) {
        const checked = edited;
        const { page: latest, ...saved } = await api.saveContentBody(sourceId, databaseId, pageId, {
          lastEditedTime: checked,
          blocks: [...sentBody],
        });
        edited = saved.lastEditedTime;
        queryClient.setQueryData(bodyKey, saved);
        queryClient.setQueryData(pageKey, latest);
        draft.bodySaved(sentBody, edited);
      }
      if (Object.keys(sentChanges).length > 0) {
        const saved = await api.updateContentPage(sourceId, databaseId, pageId, {
          lastEditedTime: edited,
          properties: sentChanges,
          expected: draft.revisions,
        });
        queryClient.setQueryData(pageKey, saved);
        // The body read at or after the time this save was checked against is still Notion's body: only the
        // properties changed since. An older body keeps its time, so editing it is still a conflict.
        queryClient.setQueryData<ContentBody>(bodyKey, (old) =>
          old && old.lastEditedTime >= edited ? { ...old, lastEditedTime: saved.lastEditedTime } : old,
        );
        draft.propertiesSaved(sentChanges, saved.lastEditedTime);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.contentEntries(sourceId, databaseId) }),
  });
}
