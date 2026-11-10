import type { ChangeView } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { PanelError, PanelLoading } from "@/features/panels/common";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { shortOid } from "@/lib/format";
import { ChangedFileList } from "./ChangedFileList";
import { useCurrentChange } from "./hooks";
import { type Notice, NoticeView, ReviewActions } from "./ReviewActions";

/** The "Changes" panel (plan 10.2): the open change set's files and one file's diff at a time. */
export function ChangesPanel({ siteId }: { siteId: string }) {
  const { m, t } = useI18n();
  const current = useCurrentChange(siteId);
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<Notice | null>(null);
  const change = current.change;

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
        <p className="whitespace-pre-wrap text-sm">{change.summary?.trim() || m.changes.noSummary}</p>
        <p className="text-xs text-muted-foreground">
          {t(m.changes.files, { count: change.files.length })} ·{" "}
          {t(m.changes.base, { commit: shortOid(change.baseCommit) })}
        </p>
        {!change.reviewable && <p className="text-xs text-muted-foreground">{m.changes.working}</p>}
        {notice && <NoticeView notice={notice} onDismiss={() => setNotice(null)} />}
        <ReviewActions siteId={siteId} change={change} onNotice={setNotice} />
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 overflow-auto border-r p-1">
          <ChangedFileList files={change.files} selected={selected} onSelect={select} />
          {change.filesTruncated && <p className="p-2 text-xs text-muted-foreground">{m.changes.more}</p>}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <DiffView key={`${change.treeHash}:${selected}`} change={change} path={selected} />
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
  const diff = useQuery({
    queryKey: keys.changeDiff(change.id, change.treeHash, path),
    queryFn: () => api.changeDiff(change.id, path),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const header = (
    <div className="flex h-9 shrink-0 items-center border-b px-3 text-xs">
      <code className="min-w-0 flex-1 truncate" title={path} data-testid="diff-path">
        {path}
      </code>
    </div>
  );
  if (diff.isPending)
    return (
      <>
        {header}
        <PanelLoading />
      </>
    );
  if (diff.error)
    return (
      <>
        {header}
        <PanelError error={diff.error} />
      </>
    );
  const note = diff.data.binary
    ? m.changes.binary
    : diff.data.tooLarge || diff.data.patch === null
      ? m.changes.tooLarge
      : null;
  return (
    <>
      {header}
      {note ? (
        <p className="p-6 text-sm text-muted-foreground" data-testid="diff-note">
          {note}
        </p>
      ) : (
        <PatchView patch={diff.data.patch ?? ""} />
      )}
    </>
  );
}

/** A unified diff, coloured by line; git's file header lines are left out (the path is shown above). */
function PatchView({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  const start = lines.findIndex((l) => l.startsWith("@@"));
  const body = (start >= 0 ? lines.slice(start) : lines).filter((l, i, all) => !(l === "" && i === all.length - 1));
  return (
    <pre className="min-h-0 flex-1 overflow-auto py-1 font-mono text-xs leading-5" data-testid="diff-patch">
      {body.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines of a fixed patch
        <div key={i} className={`px-3 whitespace-pre ${lineTone(line)}`}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function lineTone(line: string): string {
  if (line.startsWith("@@")) return "bg-muted text-muted-foreground";
  if (line.startsWith("+")) return "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300";
  if (line.startsWith("-")) return "bg-destructive/10 text-destructive";
  if (line.startsWith("\\")) return "text-muted-foreground italic";
  return "";
}
