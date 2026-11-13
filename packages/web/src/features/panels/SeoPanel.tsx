import type { AuditCompareGroup, AuditIssue, AuditReportResponse, PanelRef } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BuildButton, IssueGroups } from "@/features/builds/builds";
import { usePanelRef } from "@/features/changes/hooks";
import { useCreateSession } from "@/features/chat/sessions";
import { useI18n } from "@/i18n";
import { ApiRequestError, api, keys } from "@/lib/api";
import { formatTime, shortOid } from "@/lib/format";
import { PanelError, PanelLoading, RefSwitch } from "./common";

/** Issues put into the AI's message at most; the rest are counted. */
export const DRAFT_MAX_ISSUES = 30;

const groupKey = (g: { severity: string; code: string }) => `${g.severity}:${g.code}`;

const SEVERITY_TONE = {
  error: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-muted-foreground",
} as const;

/** The SEO / GEO report panel (plan 10.4): the newest report of a version, by page, against the previous one. */
export function SeoPanel({ siteId, readOnly }: { siteId: string; readOnly: boolean }) {
  const [ref] = usePanelRef(siteId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RefSwitch siteId={siteId} />
      <SeoBody key={ref} siteId={siteId} refName={ref} readOnly={readOnly} />
    </div>
  );
}

function SeoBody({ siteId, refName, readOnly }: { siteId: string; refName: PanelRef; readOnly: boolean }) {
  const { m } = useI18n();
  const report = useQuery({ queryKey: keys.audit(siteId, refName), queryFn: () => api.audit(siteId, refName) });
  if (report.isPending) return <PanelLoading />;
  if (report.error) {
    if (report.error instanceof ApiRequestError && report.error.code === "audit.not_built") {
      return (
        <div className="flex flex-col items-start gap-3 p-4 text-sm" data-testid="seo-not-built">
          <p className="text-muted-foreground">{refName === "change" ? m.seo.changeNotBuilt : m.seo.notBuilt}</p>
          {!readOnly && <BuildButton siteId={siteId} refName={refName} />}
        </div>
      );
    }
    return <PanelError error={report.error} />;
  }
  return <SeoReport siteId={siteId} report={report.data} readOnly={readOnly} />;
}

function SeoReport({ siteId, report, readOnly }: { siteId: string; report: AuditReportResponse; readOnly: boolean }) {
  const { m, t, locale } = useI18n();
  const [page, setPage] = useState<string | null>(null);
  const { seo, geo } = report.summary;
  const compare = report.compare;
  const issues = report.issues;
  const pages = issues ? pageCounts(issues) : [];
  // A page that is gone after a rebuild falls back to all pages.
  const current = page !== null && pages.some(([p]) => p === page) ? page : null;
  const shown = issues ? issues.filter((i) => current === null || i.route === current) : null;
  const changes = new Map((compare?.groups ?? []).map((g) => [groupKey(g), g]));
  const fixed = current === null ? (compare?.groups ?? []).filter((g) => g.change === "fixed") : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="seo-panel">
      <div className="flex flex-col gap-3 border-b p-3 text-sm">
        <p className="text-xs text-muted-foreground" data-testid="seo-source">
          {t(m.seo.source, {
            build: report.build.buildId.slice(0, 7),
            commit: shortOid(report.build.commit),
            time: report.build.finishedAt ? formatTime(report.build.finishedAt, locale) : "",
          })}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="seo-totals">
          {seo && (
            <>
              <Stat
                label={m.seo.pages}
                value={seo.routes}
                delta={report.previous?.summary.seo ? seo.routes - report.previous.summary.seo.routes : undefined}
                neutral
              />
              <Stat label={m.seo.errors} value={seo.errors} delta={compare?.errors ?? undefined} bad />
              <Stat label={m.seo.warnings} value={seo.warnings} delta={compare?.warnings ?? undefined} bad />
            </>
          )}
          {geo && (
            <Stat
              label={m.seo.geoScore}
              value={`${geo.score}/100`}
              delta={compare?.geoScore ?? undefined}
              testId="seo-geo"
            />
          )}
        </div>
        {geo && (
          <p className="text-xs text-muted-foreground">
            {m.seo.llmsTxt} {geo.llmsTxt ? m.build.audit.yes : m.build.audit.no} ·{" "}
            {t(m.build.audit.enhanced, { count: geo.enhancedRoutes })}
          </p>
        )}
        <p className="text-xs text-muted-foreground" data-testid="seo-compare">
          {report.previous
            ? report.ref === "change"
              ? m.seo.vsMain
              : m.seo.vsPrevious
            : report.ref === "change"
              ? m.seo.noMainReport
              : m.seo.noPrevious}
          {report.previous && ` · ${shortOid(report.previous.commit)}`}
        </p>
        {report.stale && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs" data-testid="seo-stale">
            {m.seo.stale}
          </p>
        )}
        {seo?.siteUrlMissing && seo.siteUrlWarnings > 0 && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs" data-testid="seo-site-url">
            {t(m.build.audit.siteUrl, { count: seo.siteUrlWarnings })}
          </p>
        )}
        {compare?.previousTruncated && <p className="text-xs text-muted-foreground">{m.seo.previousTruncated}</p>}
        {(issues || seo) && (
          <div className="flex flex-wrap items-center gap-2">
            {issues && pages.length > 0 && (
              <label className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{m.seo.filter}</span>
                <select
                  className="max-w-64 rounded-md border bg-background px-2 py-1 text-xs"
                  value={current ?? "*"}
                  onChange={(e) => setPage(e.target.value === "*" ? null : e.target.value)}
                  data-testid="seo-page-filter"
                >
                  <option value="*">{t(m.seo.allPages, { count: issues.length })}</option>
                  {pages.map(([p, count]) => (
                    <option key={p} value={p}>
                      {t(m.seo.pageOption, { page: p || m.build.audit.site, count })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!readOnly && (
              <AskAiButton
                siteId={siteId}
                draft={() =>
                  shown ? fixDraft(m.seo, t, shown, current) : summaryDraft(m.seo, t, report, m.build.audit.site)
                }
                disabled={shown ? shown.length === 0 : !seo?.groups.length}
              />
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 p-3 text-sm">
        {seo && !issues && (
          <>
            <p className="text-xs text-muted-foreground" data-testid="seo-summary-only">
              {m.seo.summaryOnly}
            </p>
            <IssueGroups groups={seo.groups} truncated={seo.groupsTruncated} />
          </>
        )}
        {shown && (
          <IssueList
            issues={shown}
            // The tags compare the whole site, not one page.
            changes={current === null ? changes : new Map()}
            empty={current === null ? m.seo.noIssues : m.seo.noIssuesOnPage}
          />
        )}
        {report.issuesTruncated && (
          <p className="text-xs text-muted-foreground">{t(m.seo.truncated, { count: issues?.length ?? 0 })}</p>
        )}
        {fixed.length > 0 && (
          <section className="flex flex-col gap-1" data-testid="seo-fixed">
            <h3 className="text-xs font-medium">{m.seo.fixed}</h3>
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {fixed.map((g) => (
                <li key={groupKey(g)}>
                  <span className={SEVERITY_TONE[g.severity]}>{m.build.audit.severity[g.severity]}</span>{" "}
                  <code>{g.code}</code> {t(m.seo.countWas, { count: 0, previous: g.previous ?? 0 })}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  delta,
  bad,
  neutral,
  testId,
}: {
  label: string;
  value: string | number;
  /** Change since the report compared with; a rise is bad for counts (`bad`), good for scores. */
  delta?: number;
  bad?: boolean;
  /** Neither direction is better (the number of pages). */
  neutral?: boolean;
  testId?: string;
}) {
  const worse = delta !== undefined && (bad ? delta > 0 : delta < 0);
  const tone = neutral
    ? "text-muted-foreground"
    : worse
      ? "text-destructive"
      : "text-emerald-600 dark:text-emerald-400";
  return (
    <div className="rounded-md border px-2 py-1.5" data-testid={testId}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-base font-medium">{value}</span>
        {delta !== undefined && delta !== 0 && (
          <span className={`text-xs ${tone}`} data-testid="seo-delta">
            {delta > 0 ? `+${delta}` : `${delta}`}
          </span>
        )}
      </div>
    </div>
  );
}

/** Issues grouped by kind (severity + code), each opening to its pages and messages. */
function IssueList({
  issues,
  changes,
  empty,
}: {
  issues: AuditIssue[];
  changes: Map<string, AuditCompareGroup>;
  empty: string;
}) {
  const { m, t } = useI18n();
  if (issues.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  const groups = new Map<string, AuditIssue[]>();
  // The server sorts errors first, then by code: grouping keeps that order.
  for (const i of issues) {
    const key = groupKey(i);
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  return (
    <ul className="flex flex-col gap-1 text-xs" data-testid="seo-issues">
      {[...groups].map(([key, list]) => {
        const first = list[0] as AuditIssue;
        const change = changes.get(key)?.change;
        const label = change ? m.seo.change[change] : "";
        return (
          <li key={key} data-testid="seo-group">
            <details>
              <summary className="cursor-pointer">
                <span className={SEVERITY_TONE[first.severity]}>{m.build.audit.severity[first.severity]}</span>{" "}
                <code>{first.code}</code>{" "}
                <span className="text-muted-foreground">{t(m.build.audit.count, { count: list.length })}</span>
                {label && (
                  <span
                    className={`ml-2 rounded px-1 ${change === "new" || change === "more" ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"}`}
                    data-testid="seo-change"
                  >
                    {label}
                  </span>
                )}
              </summary>
              <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                {list.map((i, n) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: one page can have the same issue twice
                  <li key={n} className="flex gap-2">
                    <span className="shrink-0 font-mono text-muted-foreground">{i.route || m.build.audit.site}</span>
                    <span className="min-w-0 break-words">{i.message}</span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

/** Pages with issues and how many each has, in page order; "" (the site as a whole) first. */
function pageCounts(issues: AuditIssue[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const i of issues) counts.set(i.route, (counts.get(i.route) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
}

/** Without the full list (plan 10.4): one line per kind from the summary, saying it is not complete. */
export function summaryDraft(
  m: { draft: string; draftSummary: string; draftGroup: string; draftMore: string },
  t: (s: string, v: Record<string, string | number>) => string,
  report: AuditReportResponse,
  site: string,
): string {
  const groups = report.summary.seo?.groups ?? [];
  const lines = groups.slice(0, DRAFT_MAX_ISSUES).map((g) => {
    const more = (g.moreRoutes ?? g.count > g.routes.length) ? ", …" : "";
    const pages = `${g.routes.map((r) => r || site).join(", ")}${more}`;
    return `- [${g.severity}] ${g.code} · ${t(m.draftGroup, { count: g.count, pages })}: ${g.message}`;
  });
  if (groups.length > DRAFT_MAX_ISSUES) lines.push(t(m.draftMore, { count: groups.length - DRAFT_MAX_ISSUES }));
  return `${t(m.draft, { where: "" })} ${m.draftSummary}\n\n${lines.join("\n")}`;
}

/** The message put into a new conversation (plan 10.4): what to fix, at most DRAFT_MAX_ISSUES issues. */
export function fixDraft(
  m: { draft: string; draftPage: string; draftWhole: string; draftMore: string; draftSite: string },
  t: (s: string, v: Record<string, string | number>) => string,
  issues: AuditIssue[],
  page: string | null,
): string {
  const where = page === null ? "" : page === "" ? m.draftWhole : t(m.draftPage, { page });
  const lines = issues
    .slice(0, DRAFT_MAX_ISSUES)
    .map((i) => `- [${i.severity}] ${i.code} · ${i.route || m.draftSite}: ${i.message}`);
  if (issues.length > DRAFT_MAX_ISSUES) lines.push(t(m.draftMore, { count: issues.length - DRAFT_MAX_ISSUES }));
  return `${t(m.draft, { where })}\n\n${lines.join("\n")}`;
}

function AskAiButton({ siteId, draft, disabled }: { siteId: string; draft: () => string; disabled: boolean }) {
  const { m, errorOf } = useI18n();
  const create = useCreateSession(siteId);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto"
        title={m.seo.askAiTitle}
        disabled={disabled || create.isPending}
        onClick={() => create.mutate(draft())}
        data-testid="seo-ask-ai"
      >
        <Sparkles />
        {m.seo.askAi}
      </Button>
      {create.error && (
        <span role="alert" className="text-xs text-destructive">
          {errorOf(create.error)}
        </span>
      )}
    </>
  );
}
