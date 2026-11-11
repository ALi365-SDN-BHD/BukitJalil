import type { AuditIssueGroup, Build, BuildAudit, BuildMessage, PanelRef } from "@bukitjalil/shared";
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
  // The site's state is its main version: a change set's preview build does not speak for it.
  const latest = builds.data?.builds.find((b) => b.ref === "main") ?? null;
  return { ...builds, running, latest };
}

export function useStartBuild(siteId: string, ref: PanelRef = "main") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.startBuild(siteId, ref),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.builds(siteId) }),
  });
}

export function BuildButton({
  siteId,
  disabled,
  refName = "main",
  label,
}: {
  siteId: string;
  disabled?: boolean;
  refName?: PanelRef;
  label?: string;
}) {
  const { m, errorOf } = useI18n();
  const builds = useBuilds(siteId);
  const start = useStartBuild(siteId, refName);
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        data-testid="build-button"
        disabled={disabled || builds.running || start.isPending}
        onClick={() => start.mutate()}
      >
        {builds.running || start.isPending ? <Loader2 className="animate-spin" /> : <Hammer />}
        {builds.running ? m.build.status.running : start.isPending ? m.build.starting : (label ?? m.build.start)}
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
              {b.ref === "change" && (
                <Badge tone="neutral" data-testid="build-ref">
                  {m.build.changeBuild}
                </Badge>
              )}
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
  const { m, t, errorOf, errorText } = useI18n();
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
          {report?.problem && (
            <p role="alert" className="text-destructive" data-testid="build-problem">
              {errorText(report.problem)}
            </p>
          )}
          {build.data?.outcome === "failed" && !report?.problem && (
            <p className="text-muted-foreground" data-testid="build-crashed">
              {m.build.crashed}
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
          {report && build.data?.status === "succeeded" && <AuditSection audit={report.audit ?? null} />}
          {report && <ReportLog messages={report.messages} output={report.output} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The SEO / GEO summary of a successful build (plan M4 layer 7). */
function AuditSection({ audit }: { audit: BuildAudit | null }) {
  const { m, t } = useI18n();
  const a = m.build.audit;
  if (!audit) {
    return (
      <section data-testid="build-audit">
        <h3 className="mb-1 font-medium">{a.title}</h3>
        <p className="text-muted-foreground">{a.none}</p>
      </section>
    );
  }
  const { seo, geo } = audit;
  return (
    <section className="flex flex-col gap-2" data-testid="build-audit">
      <h3 className="font-medium">{a.title}</h3>
      {seo && (
        <div className="flex flex-col gap-1.5" data-testid="audit-seo">
          <p>
            <span className="font-medium">{a.seo}</span>{" "}
            <span className="text-muted-foreground">
              {t(a.seoSummary, { routes: seo.routes, errors: seo.errors, warnings: seo.warnings })}
            </span>
          </p>
          {seo.siteUrlMissing && seo.siteUrlWarnings > 0 && (
            <p
              className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs"
              data-testid="audit-site-url"
            >
              {t(a.siteUrl, { count: seo.siteUrlWarnings })}
            </p>
          )}
          <IssueGroups groups={seo.groups} truncated={seo.groupsTruncated} />
        </div>
      )}
      {geo && (
        <div className="flex flex-col gap-1" data-testid="audit-geo">
          <p>
            <span className="font-medium">{a.geo}</span>{" "}
            <span className="text-muted-foreground" data-testid="audit-geo-score">
              {t(a.geoScore, { score: geo.score })}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {a.llmsTxt} {geo.llmsTxt ? a.yes : a.no} · {a.llmsFullTxt} {geo.llmsFullTxt ? a.yes : a.no} ·{" "}
            {t(a.enhanced, { count: geo.enhancedRoutes })}
          </p>
          {geo.enhancedRoutes === 0 && <p className="text-xs text-muted-foreground">{a.geoHint}</p>}
        </div>
      )}
    </section>
  );
}

/** Audit issues grouped by kind, each opening to its message and pages (SEO and publish audits). */
export function IssueGroups({ groups, truncated }: { groups: AuditIssueGroup[]; truncated: boolean }) {
  const { m, t } = useI18n();
  const a = m.build.audit;
  return (
    <>
      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">{a.noIssues}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-xs">
          {groups.map((g) => (
            <li key={`${g.severity}:${g.code}`} data-testid="audit-group">
              <details>
                <summary className="cursor-pointer">
                  <span
                    className={
                      g.severity === "error"
                        ? "text-destructive"
                        : g.severity === "warning"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                    }
                  >
                    {a.severity[g.severity]}
                  </span>{" "}
                  <code>{g.code}</code> <span className="text-muted-foreground">{t(a.count, { count: g.count })}</span>
                </summary>
                <div className="mt-1 flex flex-col gap-0.5 pl-4">
                  <span>{g.message}</span>
                  <span className="text-muted-foreground">
                    {g.routes.map((r) => r || a.site).join(" · ")}
                    {(g.moreRoutes ?? g.count > g.routes.length) && " …"}
                  </span>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      {truncated && <p className="text-xs text-muted-foreground">{a.more}</p>}
    </>
  );
}

/** Bukit's warning and error lines, then the end of its text output. */
export function ReportLog({ messages, output }: { messages: BuildMessage[]; output: string }) {
  const { m } = useI18n();
  return (
    <>
      <section>
        <h3 className="mb-1 font-medium">{m.build.messages}</h3>
        {messages.length === 0 ? (
          <p className="text-muted-foreground">{m.build.noMessages}</p>
        ) : (
          <ul className="flex flex-col gap-1 font-mono text-xs">
            {messages.map((msg, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: log lines in order
                key={i}
                className={
                  /error|fatal|critical/i.test(msg.level) ? "text-destructive" : "text-amber-600 dark:text-amber-400"
                }
              >
                [{msg.level}] {msg.msg}
              </li>
            ))}
          </ul>
        )}
      </section>
      {output && (
        <section>
          <h3 className="mb-1 font-medium">{m.build.output}</h3>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{output}</pre>
        </section>
      )}
    </>
  );
}
