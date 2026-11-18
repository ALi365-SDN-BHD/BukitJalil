import type { ChangeView } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { MediaUpload, type MediaUploadHandle } from "@/features/media/MediaUpload";
import { PanelError, PanelLoading } from "@/features/panels/common";
import { useI18n } from "@/i18n";
import { api, fileUrl, keys } from "@/lib/api";
import { shortOid } from "@/lib/format";
import { ChangedFileList } from "./ChangedFileList";
import { FileDiffView } from "./FileDiffView";
import { useCurrentChange } from "./hooks";
import { NotionChangesNote } from "./NotionChangesNote";
import { RestoreNote } from "./RestoreNote";
import { type Notice, NoticeView, ReviewActions } from "./ReviewActions";
import { canPick, reviewKey, useSelection } from "./selection";

/** The "Changes" panel (plan 10.2): the open change set's files and one file's diff at a time. */
export function ChangesPanel({ siteId, readOnly }: { siteId: string; readOnly: boolean }) {
  const { m, t } = useI18n();
  const current = useCurrentChange(siteId);
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<Notice | null>(null);
  const change = current.change;
  const selection = useSelection(change);
  // The preview toolbar's "upload" button switches here with upload=1; this is the one place that keeps
  // the queue and the file list, so it opens the picker once the panel is ready.
  const uploader = useRef<MediaUploadHandle>(null);
  const wantsUpload = params.get("upload") === "1";
  useEffect(() => {
    if (!wantsUpload || current.isPending) return;
    uploader.current?.open();
    setParams(
      (p) => {
        p.delete("upload");
        return p;
      },
      { replace: true },
    );
  }, [wantsUpload, current.isPending, setParams]);

  if (current.isPending) return <PanelLoading />;
  if (current.error) return <PanelError error={current.error} />;
  const wanted = params.get("diff");
  // One tree for both states: an upload creates the change set, and a remount here would throw away the
  // queue and the "replace or skip" dialog of the upload that caused it.
  const shown = change && (change.files.length > 0 || change.filesTruncated) ? change : null;
  const selected = shown
    ? shown.files.some((f) => f.path === wanted)
      ? wanted
      : (shown.files[0]?.path ?? null)
    : null;
  const select = (path: string) =>
    setParams(
      (p) => {
        p.set("diff", path);
        return p;
      },
      { replace: true },
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="changes-panel">
      <div className={`flex shrink-0 flex-col gap-2 ${shown ? "border-b p-3" : "p-4"}`}>
        {!shown && notice && <NoticeView notice={notice} onDismiss={() => setNotice(null)} />}
        {shown?.restoreOf && <RestoreNote commit={shown.restoreOf} />}
        {shown && <NotionChangesNote changes={shown.notionChanges} />}
        <div className="flex items-start justify-between gap-2">
          <p
            className={shown ? "whitespace-pre-wrap text-sm" : "text-sm text-muted-foreground"}
            data-testid={shown ? undefined : "changes-empty"}
          >
            {shown ? shown.summary?.trim() || m.changes.noSummary : change ? m.changes.noChanges : m.changes.none}
          </p>
          <MediaUpload
            ref={uploader}
            siteId={siteId}
            disabled={readOnly}
            disabledReason={m.conversation.readOnlyHint}
            trigger={
              <>
                <Upload /> {m.media.upload}
              </>
            }
            ariaLabel={m.media.upload}
            size="xs"
          />
        </div>
        {shown && (
          <>
            <p className="text-xs text-muted-foreground">
              {t(m.changes.files, { count: shown.files.length })} ·{" "}
              {t(m.changes.base, { commit: shortOid(shown.baseCommit) })}
            </p>
            {!shown.reviewable && <p className="text-xs text-muted-foreground">{m.changes.working}</p>}
            {canPick(shown) && <p className="text-xs text-muted-foreground">{m.changes.selectionHint}</p>}
            {notice && <NoticeView notice={notice} onDismiss={() => setNotice(null)} />}
            <ReviewActions siteId={siteId} change={shown} onNotice={setNotice} />
          </>
        )}
      </div>
      {shown && (
        <div className="flex min-h-0 flex-1">
          <nav className="w-56 shrink-0 overflow-auto border-r p-1">
            <ChangedFileList
              files={shown.files}
              selected={selected}
              onSelect={select}
              include={canPick(shown) ? { on: selection.fileOn, set: selection.setFile } : undefined}
            />
            {shown.filesTruncated && <p className="p-2 text-xs text-muted-foreground">{m.changes.more}</p>}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              <DiffView key={`${reviewKey(shown)}:${selected}`} change={shown} path={selected} />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">{m.changes.selectFile}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DiffView({ change, path }: { change: ChangeView; path: string }) {
  const { m } = useI18n();
  const selection = useSelection(change);
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  // A deleted file has no bytes in the change's tree, so its preview would be a broken image or link.
  const present = change.files.find((f) => f.path === path)?.status !== "deleted";
  const image = present && ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
  const pdf = present && ext === "pdf";
  const preview = image ? (
    <div className="flex max-h-80 shrink-0 items-center justify-center overflow-auto border-b bg-muted/20 p-3">
      <img
        src={fileUrl(change.siteId, "change", path, "raw")}
        alt={path}
        className="max-h-72 max-w-full object-contain"
        data-testid="media-preview"
      />
    </div>
  ) : pdf ? (
    <div className="shrink-0 border-b p-3">
      <a
        className="inline-flex items-center gap-1 text-sm underline"
        href={fileUrl(change.siteId, "change", path, "download")}
        download
      >
        <Download className="size-4" /> {m.media.download}
      </a>
    </div>
  ) : undefined;
  // Keyed by base and tree: after a partial apply the rest has the same tree and another diff.
  const diff = useQuery({
    queryKey: keys.changeDiff(change.id, `${change.baseCommit}:${change.treeHash}`, path),
    queryFn: () => api.changeDiff(change.id, path),
    staleTime: Number.POSITIVE_INFINITY,
  });
  // The server says which files can be split by hunk (never a restore's).
  const listed = change.files.some((f) => f.path === path);
  const hunks =
    diff.data?.splittable && canPick(change) && listed
      ? {
          on: (i: number) => selection.hunkOn(path, i),
          set: (i: number, on: boolean, total: number) => selection.setHunk(path, i, on, total),
        }
      : undefined;
  return <FileDiffView path={path} diff={diff} hunks={hunks} preview={preview} />;
}
