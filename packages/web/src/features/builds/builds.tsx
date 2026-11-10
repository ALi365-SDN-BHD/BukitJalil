import type { Build } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hammer, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { formatDuration, formatTime, shortOid } from "@/lib/format";

/**
 * A site's builds, polled every second while one runs (build events arrive with SSE in M3). When a
 * build ends, the site (its state may change) and the preview are fetched again.
 */
export function useBuilds(siteId: string) {
  const queryClient = useQueryClient();
  const builds = useQuery({
    queryKey: keys.builds(siteId),
    queryFn: () => api.builds(siteId),
    refetchInterval: (q) => (q.state.data?.builds.some((b) => b.status === "running") ? 1000 : false),
  });
  const running = builds.data?.builds.some((b) => b.status === "running") ?? false;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) {
      void queryClient.invalidateQueries({ queryKey: keys.site(siteId) });
      void queryClient.invalidateQueries({ queryKey: keys.sites });
      void queryClient.invalidateQueries({ queryKey: ["preview", siteId] });
    }
    wasRunning.current = running;
  }, [running, siteId, queryClient]);
  return { ...builds, running, latest: builds.data?.builds[0] ?? null };
}

export function useStartBuild(siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.startBuild(siteId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.builds(siteId) }),
  });
}

export function BuildButton({ siteId, disabled }: { siteId: string; disabled?: boolean }) {
  const { m, errorOf } = useI18n();
  const builds = useBuilds(siteId);
  const start = useStartBuild(siteId);
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        data-testid="build-button"
        disabled={disabled || builds.running || start.isPending}
        onClick={() => start.mutate()}
      >
        {builds.running || start.isPending ? <Loader2 className="animate-spin" /> : <Hammer />}
        {builds.running ? m.build.status.running : start.isPending ? m.build.starting : m.build.start}
      </Button>
      {start.error && (
        <span role="alert" className="text-xs text-destructive">
          {errorOf(start.error)}
        </span>
      )}
    </div>
  );
}

export function BuildBadge({ build }: { build: Build }) {
  const { m } = useI18n();
  const tone = build.status === "running" ? "busy" : build.status === "succeeded" ? "ok" : "error";
  const label =
    build.status === "failed" && build.outcome ? m.build.outcome[build.outcome] : m.build.status[build.status];
  return (
    <Badge tone={tone} data-testid="build-status">
      {build.status === "running" && <Loader2 className="size-3 animate-spin" />}
      {label}
    </Badge>
  );
}

/** One line per build; clicking opens its report. */
export function BuildList({ siteId, limit = 5 }: { siteId: string; limit?: number }) {
  const { m, t, locale } = useI18n();
  const builds = useBuilds(siteId);
  const [open, setOpen] = useState<string | null>(null);
  const list = builds.data?.builds.slice(0, limit) ?? [];
  if (builds.isPending) return <p className="text-sm text-muted-foreground">{m.common.loading}</p>;
  if (list.length === 0) return <p className="text-sm text-muted-foreground">{m.site.noBuilds}</p>;
  return (
    <>
      <ul className="flex flex-col divide-y rounded-md border text-sm" data-testid="build-list">
        {list.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/60"
              onClick={() => setOpen(b.id)}
            >
              <BuildBadge build={b} />
              <span className="text-muted-foreground">{t(m.build.commit, { commit: shortOid(b.commit) })}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {formatTime(b.startedAt, locale)}
                {b.finishedAt && ` · ${formatDuration(b.startedAt, b.finishedAt, locale)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && <BuildReportDialog siteId={siteId} buildId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function BuildReportDialog({ siteId, buildId, onClose }: { siteId: string; buildId: string; onClose: () => void }) {
  const { m, t, errorOf } = useI18n();
  const build = useQuery({
    queryKey: ["build", siteId, buildId],
    queryFn: () => api.build(siteId, buildId),
    // The report arrives when the build ends.
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1000 : false),
  });
  const report = build.data?.report;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={m.common.close} className="max-w-2xl">
        <DialogTitle className="flex items-center gap-2">
          {m.build.report}
          {build.data && <BuildBadge build={build.data} />}
        </DialogTitle>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto text-sm" data-testid="build-report">
          {build.error && <p className="text-destructive">{errorOf(build.error)}</p>}
          {build.data && (
            <p className="text-muted-foreground">
              {t(m.build.commit, { commit: shortOid(build.data.commit) })}
              {build.data.exitCode !== null && ` · exit ${build.data.exitCode}`}
            </p>
          )}
          {report?.detail && <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{report.detail}</pre>}
          {report?.reasons && report.reasons.length > 0 && (
            <ul className="list-disc pl-5">
              {report.reasons.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a static list
                <li key={i}>
                  {m.reasons[r.code]} {r.where && <code className="text-xs">{r.where}</code>}
                </li>
              ))}
            </ul>
          )}
          {report && (
            <section>
              <h3 className="mb-1 font-medium">{m.build.messages}</h3>
              {report.messages.length === 0 ? (
                <p className="text-muted-foreground">{m.build.noMessages}</p>
              ) : (
                <ul className="flex flex-col gap-1 font-mono text-xs">
                  {report.messages.map((msg, i) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: log lines in order
                      key={i}
                      className={
                        /error|fatal|critical/i.test(msg.level)
                          ? "text-destructive"
                          : "text-amber-600 dark:text-amber-400"
                      }
                    >
                      [{msg.level}] {msg.msg}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {report?.output && (
            <section>
              <h3 className="mb-1 font-medium">{m.build.output}</h3>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
                {report.output}
              </pre>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
