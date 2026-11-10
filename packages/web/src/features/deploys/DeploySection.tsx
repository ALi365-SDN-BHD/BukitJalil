import { type Deploy, type DeployStatusResponse, deploySteps, type Site } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, Loader2, Rocket, Square, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { IssueGroups, ReportLog } from "@/features/builds/builds";
import { useCreateSession } from "@/features/chat/sessions";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { formatDuration, formatTime, shortOid } from "@/lib/format";

export function useDeployStatus(siteId: string) {
  return useQuery({ queryKey: keys.deploy(siteId), queryFn: () => api.deployStatus(siteId) });
}

function useDeploys(siteId: string) {
  return useQuery({
    queryKey: keys.deploys(siteId),
    queryFn: () => api.deploys(siteId),
    // Events keep it current; poll only while one runs, in case the event stream drops.
    refetchInterval: (q) => (q.state.data?.deploys.some((d) => d.status === "running") ? 3000 : false),
  });
}

/**
 * Publishing (plan 14 M6): where the site goes and whether the token is set, how to set the target, then
 * publishing after a confirmation that names the repository, branch and version, with its steps and records.
 */
export function DeploySection({ site, onOpenSettings }: { site: Site; onOpenSettings: () => void }) {
  const { m, errorOf } = useI18n();
  const d = m.deploy;
  const status = useDeployStatus(site.id);
  const deploys = useDeploys(site.id);
  const create = useCreateSession(site.id);
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const target = status.data?.target;
  const running = deploys.data?.deploys.find((x) => x.status === "running") ?? null;

  return (
    <section className="flex flex-col gap-2" data-testid="deploy-section">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        <Rocket className="size-4 text-muted-foreground" aria-hidden /> {d.title}
      </h2>
      {status.error && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(status.error)}
        </p>
      )}
      {!status.data && !status.error && <p className="text-xs text-muted-foreground">{m.common.loading}</p>}
      {target && status.data && (
        <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
          {target.problem === null ? (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1" data-testid="deploy-target">
              <dt className="text-muted-foreground">{d.repo}</dt>
              <dd>
                <code className="break-all text-xs">{target.repo}</code>
              </dd>
              <dt className="text-muted-foreground">{d.branch}</dt>
              <dd>
                <code className="text-xs">{target.branch}</code>
              </dd>
              {target.url && (
                <>
                  <dt className="text-muted-foreground">{d.url}</dt>
                  <dd>
                    <a className="break-all text-xs underline" href={target.url} target="_blank" rel="noreferrer">
                      {target.url}
                    </a>
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="deploy-problem">
              {d.problems[target.problem]}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {status.data.token ? (
              <Badge tone="ok">{d.tokenSet}</Badge>
            ) : (
              <>
                <Badge tone="warn">{d.tokenMissing}</Badge>
                <Button size="xs" variant="outline" onClick={onOpenSettings} data-testid="deploy-open-settings">
                  {d.openSettings}
                </Button>
              </>
            )}
            {target.problem !== null && target.problem !== "no_config" && !site.readOnly && (
              <Button
                size="xs"
                variant="outline"
                data-testid="deploy-ask-ai"
                disabled={create.isPending}
                onClick={() => create.mutate(d.askAiDraft)}
              >
                {d.askAi}
              </Button>
            )}
            {target.problem === null && (
              <Button
                size="sm"
                className="ml-auto"
                data-testid="deploy-start"
                disabled={!status.data.ready || running !== null}
                title={running ? d.running : undefined}
                onClick={() => setConfirming(true)}
              >
                <Rocket /> {d.publish}
              </Button>
            )}
          </div>
          {create.error && (
            <p role="alert" className="text-xs text-destructive">
              {errorOf(create.error)}
            </p>
          )}
          {running && <DeployProgress siteId={site.id} deploy={running} />}
        </div>
      )}
      {deploys.data && deploys.data.deploys.length > 0 && (
        <DeployList deploys={deploys.data.deploys.slice(0, 5)} onOpen={setOpen} />
      )}
      {confirming && status.data && (
        <ConfirmDialog
          siteId={site.id}
          status={status.data}
          onClose={() => setConfirming(false)}
          onStarted={() => setConfirming(false)}
        />
      )}
      {open && <DeployReportDialog siteId={site.id} deployId={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** Names exactly what is published where; publishing pushes to GitHub and cannot be taken back from here. */
function ConfirmDialog({
  siteId,
  status,
  onClose,
  onStarted,
}: {
  siteId: string;
  status: DeployStatusResponse;
  onClose: () => void;
  onStarted: () => void;
}) {
  const { m, t, errorOf } = useI18n();
  const d = m.deploy;
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: () => api.startDeploy(siteId, status.commit),
    onSuccess: (deploy) => {
      queryClient.setQueryData(keys.deploys(siteId), (list: { deploys: Deploy[] } | undefined) => ({
        deploys: [deploy, ...(list?.deploys ?? []).filter((x) => x.id !== deploy.id)],
      }));
      onStarted();
    },
    // The version moved on meanwhile: show the new one before anything is published.
    onError: () => void queryClient.invalidateQueries({ queryKey: keys.deploy(siteId) }),
  });
  const { target } = status;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={m.common.close}>
        <DialogTitle>{d.confirmTitle}</DialogTitle>
        <DialogDescription>{d.confirmText}</DialogDescription>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm" data-testid="deploy-confirm">
          <dt className="text-muted-foreground">{d.repo}</dt>
          <dd>
            <code className="break-all text-xs">github.com/{target.repo}</code>
          </dd>
          <dt className="text-muted-foreground">{d.branch}</dt>
          <dd>
            <code className="text-xs">{target.branch}</code>
          </dd>
          <dt className="text-muted-foreground">{d.version}</dt>
          <dd>
            <code className="text-xs">{shortOid(status.commit)}</code>
          </dd>
          {target.url && (
            <>
              <dt className="text-muted-foreground">{d.url}</dt>
              <dd className="break-all text-xs">{target.url}</dd>
            </>
          )}
        </dl>
        <p className="text-xs text-muted-foreground">{t(d.confirmNote, { branch: target.branch })}</p>
        {start.error && (
          <p role="alert" className="text-xs text-destructive">
            {errorOf(start.error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button
            size="sm"
            data-testid="deploy-confirm-start"
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? <Loader2 className="animate-spin" /> : <Rocket />} {d.publishNow}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The steps of a running publish, and a way to stop it. */
function DeployProgress({ siteId, deploy }: { siteId: string; deploy: Deploy }) {
  const { m, errorOf } = useI18n();
  const d = m.deploy;
  const stop = useMutation({ mutationFn: () => api.stopDeploy(siteId, deploy.id) });
  const current = deploy.step ? deploySteps.indexOf(deploy.step) : 0;
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-muted/40 p-2" data-testid="deploy-progress">
      <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {deploySteps.map((step, i) => (
          <li
            key={step}
            className={`flex items-center gap-1 ${i > current ? "text-muted-foreground" : ""}`}
            data-testid={`deploy-step-${step}`}
            data-state={i < current ? "done" : i === current ? "running" : "waiting"}
          >
            {i < current ? (
              <Check className="size-3 text-emerald-600" />
            ) : i === current ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Circle className="size-3" />
            )}
            {d.steps[step]}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          data-testid="deploy-stop"
          disabled={stop.isPending}
          onClick={() => stop.mutate()}
        >
          <Square /> {d.stop}
        </Button>
        {stop.error && <span className="text-xs text-destructive">{errorOf(stop.error)}</span>}
      </div>
    </div>
  );
}

export function DeployBadge({ deploy }: { deploy: Deploy }) {
  const { m } = useI18n();
  const d = m.deploy;
  const tone = deploy.status === "running" ? "busy" : deploy.status === "succeeded" ? "ok" : "error";
  let label = d.status[deploy.status];
  if (deploy.status === "failed" && deploy.outcome === "step_failed" && deploy.step) {
    label = `${d.status.failed} · ${d.steps[deploy.step]}`;
  } else if (deploy.status === "failed" && deploy.outcome) label = d.outcome[deploy.outcome];
  return (
    <Badge tone={tone} data-testid="deploy-status">
      {deploy.status === "running" && <Loader2 className="size-3 animate-spin" />}
      {label}
    </Badge>
  );
}

function DeployList({ deploys, onOpen }: { deploys: Deploy[]; onOpen: (id: string) => void }) {
  const { m, t, locale } = useI18n();
  return (
    <ul className="flex flex-col divide-y rounded-md border text-sm" data-testid="deploy-list">
      {deploys.map((x) => (
        <li key={x.id}>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/60"
            onClick={() => onOpen(x.id)}
          >
            <DeployBadge deploy={x} />
            <span className="text-muted-foreground">{t(m.build.commit, { commit: shortOid(x.commit) })}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {formatTime(x.startedAt, locale)}
              {x.finishedAt && ` · ${formatDuration(x.startedAt, x.finishedAt, locale)}`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DeployReportDialog({ siteId, deployId, onClose }: { siteId: string; deployId: string; onClose: () => void }) {
  const { m, t, errorOf, errorText } = useI18n();
  const d = m.deploy;
  const deploy = useQuery({
    queryKey: ["deploy-report", siteId, deployId],
    queryFn: () => api.deploy(siteId, deployId),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1000 : false),
  });
  const x = deploy.data;
  const report = x?.report;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={m.common.close} className="max-w-2xl">
        <DialogTitle className="flex items-center gap-2">
          {d.report}
          {x && <DeployBadge deploy={x} />}
        </DialogTitle>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto text-sm" data-testid="deploy-report">
          {deploy.error && <p className="text-destructive">{errorOf(deploy.error)}</p>}
          {x && (
            <p className="text-muted-foreground">
              {t(d.reportTarget, { repo: x.repo, branch: x.branch, commit: shortOid(x.commit) })}
            </p>
          )}
          {x?.status === "succeeded" && x.url && (
            <p data-testid="deploy-url">
              {d.published}{" "}
              <a className="underline" href={x.url} target="_blank" rel="noreferrer">
                {x.url}
              </a>
              <span className="block text-xs text-muted-foreground">{d.publishedNote}</span>
            </p>
          )}
          {report && report.steps.length > 0 && (
            <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs" data-testid="deploy-steps">
              {report.steps.map((s) => (
                <li key={s.step} className="flex items-center gap-1">
                  {s.ok ? <Check className="size-3 text-emerald-600" /> : <X className="size-3 text-destructive" />}
                  {d.steps[s.step]}
                </li>
              ))}
            </ol>
          )}
          {report?.problem && (
            <p role="alert" className="text-destructive">
              {errorText(report.problem)}
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
          {report?.audit && (
            <section className="flex flex-col gap-1.5" data-testid="deploy-audit">
              <h3 className="font-medium">{d.audit}</h3>
              <p className="text-muted-foreground">
                {t(m.build.audit.seoSummary, {
                  routes: report.audit.routes,
                  errors: report.audit.errors,
                  warnings: report.audit.warnings,
                })}
              </p>
              <IssueGroups groups={report.audit.groups} truncated={report.audit.groupsTruncated} />
            </section>
          )}
          {report && <ReportLog messages={report.messages} output={report.output} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
