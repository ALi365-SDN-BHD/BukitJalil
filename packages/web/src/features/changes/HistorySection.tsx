import type { HistoryEntry, RestoreResult, Site } from "@bukitjalil/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, History } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PanelError, PanelLoading } from "@/features/panels/common";
import { ReasonList } from "@/features/sites/ReasonList";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { formatTime, shortOid } from "@/lib/format";
import { ChangedFileList } from "./ChangedFileList";
import { FileDiffView } from "./FileDiffView";
import { useCurrentChange } from "./hooks";

/**
 * Version history on the site home (plan 7.4, 10.2): the default branch's versions, newest first, a page
 * at a time. Opening one shows what it changed and offers to restore it.
 */
export function HistorySection({ site }: { site: Site }) {
  const { m, t, locale } = useI18n();
  const [open, setOpen] = useState<{ entry: HistoryEntry; latest: boolean } | null>(null);
  const history = useInfiniteQuery({
    queryKey: keys.history(site.id),
    queryFn: ({ pageParam }) => api.history(site.id, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.reduce((n, p) => n + p.entries.length, 0) : undefined),
  });

  let body: React.ReactNode;
  if (history.isPending) body = <PanelLoading />;
  else if (history.error) body = <PanelError error={history.error} />;
  else {
    // Pages are offsets from the newest version, so a version that lands between two pages shifts the
    // next page by one; drop what an earlier page already listed.
    const seen = new Set<string>();
    const entries = history.data.pages
      .flatMap((p) => p.entries)
      .filter((e) => !seen.has(e.commit) && seen.add(e.commit));
    body =
      entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{m.history.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border text-sm" data-testid="history-list">
          {entries.map((e, i) => (
            <li key={e.commit}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/60"
                onClick={() => setOpen({ entry: e, latest: i === 0 })}
                data-testid="history-entry"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{e.subject || m.history.noSubject}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <code>{shortOid(e.commit)}</code> · {e.authorName} · {formatTime(e.date, locale)} ·{" "}
                    {t(m.changes.files, { count: e.filesChanged })}
                  </span>
                </span>
                {i === 0 && <Badge tone="ok">{m.history.current}</Badge>}
                {e.byAi && (
                  <Badge>
                    <Bot className="size-3" aria-hidden /> {m.history.ai}
                  </Badge>
                )}
                {e.restoreOf && (
                  <Badge tone="busy">
                    <History className="size-3" aria-hidden /> {m.history.restored}
                  </Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      );
  }

  return (
    <section className="flex flex-col gap-2" data-testid="history">
      <h2 className="text-sm font-medium">{m.history.title}</h2>
      {body}
      {history.hasNextPage && (
        <Button
          size="sm"
          variant="ghost"
          className="w-fit"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {m.history.more}
        </Button>
      )}
      {open && (
        <VersionDialog
          key={open.entry.commit}
          site={site}
          entry={open.entry}
          latest={open.latest}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

function VersionDialog({
  site,
  entry,
  latest,
  onClose,
}: {
  site: Site;
  entry: HistoryEntry;
  latest: boolean;
  onClose: () => void;
}) {
  const { m, t, errorOf, locale } = useI18n();
  const queryClient = useQueryClient();
  const [, setParams] = useSearchParams();
  const { change } = useCurrentChange(site.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [restored, setRestored] = useState<RestoreResult | null>(null);
  const diff = useQuery({
    queryKey: keys.versionDiff(site.id, entry.commit),
    queryFn: () => api.versionDiff(site.id, entry.commit),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const path = selected ?? diff.data?.files[0]?.path ?? null;
  const fileDiff = useQuery({
    queryKey: keys.versionDiff(site.id, entry.commit, path ?? ""),
    queryFn: () => api.versionFileDiff(site.id, entry.commit, path ?? ""),
    enabled: path !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const openChanges = () => {
    onClose();
    setParams((p) => {
      p.set("panel", "changes");
      p.delete("file");
      p.delete("diff");
      return p;
    });
  };
  const restore = useMutation({
    mutationFn: () => api.restore(site.id, entry.commit),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: keys.change(site.id) });
      if (result.guard.ok) openChanges();
      else setRestored(result);
    },
  });
  // Why restoring is not offered right now, if it is not.
  const blocked = site.readOnly
    ? m.history.blockedReadOnly
    : latest
      ? m.history.blockedLatest
      : change && (change.files.length > 0 || change.filesTruncated)
        ? m.history.blockedOpen
        : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={m.common.close} className="max-w-4xl" data-testid="version-dialog">
        <DialogTitle className="pr-6">{entry.subject || m.history.noSubject}</DialogTitle>
        <DialogDescription>
          <code>{shortOid(entry.commit)}</code> · {entry.authorName} &lt;{entry.authorEmail}&gt; ·{" "}
          {formatTime(entry.date, locale)}
        </DialogDescription>
        {entry.body && <p className="whitespace-pre-wrap text-sm">{entry.body}</p>}
        {entry.restoreOf && (
          <p className="text-xs text-muted-foreground">
            {t(m.history.restoreNote, { commit: shortOid(entry.restoreOf) })}
          </p>
        )}
        <div className="flex h-[50dvh] min-h-0 rounded-md border">
          {diff.isPending ? (
            <PanelLoading />
          ) : diff.error ? (
            <PanelError error={diff.error} />
          ) : diff.data.files.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{m.history.noFiles}</p>
          ) : (
            <>
              <nav className="w-56 shrink-0 overflow-auto border-r p-1">
                <ChangedFileList files={diff.data.files} selected={path} onSelect={setSelected} />
                {diff.data.filesTruncated && <p className="p-2 text-xs text-muted-foreground">{m.changes.more}</p>}
              </nav>
              <div className="flex min-w-0 flex-1 flex-col">
                {path && <FileDiffView key={path} path={path} diff={fileDiff} />}
              </div>
            </>
          )}
        </div>
        {restored ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <p>{m.history.guardWarning}</p>
            <ReasonList reasons={restored.guard.reasons} />
            <Button size="sm" className="w-fit" onClick={openChanges}>
              {m.history.openChanges}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-3">
            {(blocked || restore.error) && (
              <p className={`text-xs ${restore.error ? "text-destructive" : "text-muted-foreground"}`} role="status">
                {restore.error ? errorOf(restore.error) : blocked}
              </p>
            )}
            <Button
              size="sm"
              data-testid="version-restore"
              disabled={blocked !== null || restore.isPending}
              onClick={() => restore.mutate()}
            >
              <History /> {m.history.restore}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
