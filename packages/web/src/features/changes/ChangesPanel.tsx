import type { ChangeView } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { PanelError, PanelLoading } from "@/features/panels/common";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { shortOid } from "@/lib/format";
import { ChangedFileList } from "./ChangedFileList";
import { FileDiffView } from "./FileDiffView";
import { useCurrentChange } from "./hooks";
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
        <p className="text-sm text-muted-foreground" data-testid="changes-empty">
          {change ? m.changes.noChanges : m.changes.none}
        </p>
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
        <p className="whitespace-pre-wrap text-sm">{change.summary?.trim() || m.changes.noSummary}</p>
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
  const selection = useSelection(change);
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
  return <FileDiffView path={path} diff={diff} hunks={hunks} />;
}
