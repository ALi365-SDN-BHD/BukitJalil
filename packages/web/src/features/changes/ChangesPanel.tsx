import type { ChangeView } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { MediaUpload } from "@/features/media/MediaUpload";
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
export function ChangesPanel({ siteId }: { siteId: string }) {
  const { m, t } = useI18n();
  const current = useCurrentChange(siteId);
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<Notice | null>(null);
  const change = current.change;
  const selection = useSelection(change);

  if (current.isPending) return <PanelLoading />;
  if (current.error) return <PanelError error={current.error} />;
  const hasFiles = !!change && (change.files.length > 0 || change.filesTruncated);
  if (!change || !hasFiles) {
    return (
      <div className="flex flex-1 flex-col gap-2 p-4">
        {notice && <NoticeView notice={notice} onDismiss={() => setNotice(null)} />}
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-muted-foreground" data-testid="changes-empty">
            {change ? m.changes.noChanges : m.changes.none}
          </p>
          <MediaUpload
            siteId={siteId}
            trigger={
              <>
                <Upload /> {m.media.upload}
              </>
            }
            ariaLabel={m.media.upload}
            size="xs"
          />
        </div>
      </div>
    );
  }
  const wanted = params.get("diff");
  const selected = change.files.some((f) => f.path === wanted) ? wanted : (change.files[0]?.path ?? null);
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
      <div className="flex shrink-0 flex-col gap-2 border-b p-3">
        {change.restoreOf && <RestoreNote commit={change.restoreOf} />}
        <NotionChangesNote changes={change.notionChanges} />
        <div className="flex items-start justify-between gap-2">
          <p className="whitespace-pre-wrap text-sm">{change.summary?.trim() || m.changes.noSummary}</p>
          <MediaUpload
            siteId={siteId}
            trigger={
              <>
                <Upload /> {m.media.upload}
              </>
            }
            ariaLabel={m.media.upload}
            size="xs"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t(m.changes.files, { count: change.files.length })} ·{" "}
          {t(m.changes.base, { commit: shortOid(change.baseCommit) })}
        </p>
        {!change.reviewable && <p className="text-xs text-muted-foreground">{m.changes.working}</p>}
        {canPick(change) && <p className="text-xs text-muted-foreground">{m.changes.selectionHint}</p>}
        {notice && <NoticeView notice={notice} onDismiss={() => setNotice(null)} />}
        <ReviewActions siteId={siteId} change={change} onNotice={setNotice} />
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 overflow-auto border-r p-1">
          <ChangedFileList
            files={change.files}
            selected={selected}
            onSelect={select}
            include={canPick(change) ? { on: selection.fileOn, set: selection.setFile } : undefined}
          />
          {change.filesTruncated && <p className="p-2 text-xs text-muted-foreground">{m.changes.more}</p>}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <DiffView key={`${reviewKey(change)}:${selected}`} change={change} path={selected} />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">{m.changes.selectFile}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function DiffView({ change, path }: { change: ChangeView; path: string }) {
  const { m } = useI18n();
  const selection = useSelection(change);
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const image = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
  const pdf = ext === "pdf";
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
