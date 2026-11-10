import type { Site } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCreateSession } from "@/features/chat/sessions";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";

export function useDeployStatus(siteId: string) {
  return useQuery({ queryKey: keys.deploy(siteId), queryFn: () => api.deployStatus(siteId) });
}

/** Publishing (plan 14 M6): where the site goes, whether the token is set, and how to set the target. */
export function DeploySection({ site, onOpenSettings }: { site: Site; onOpenSettings: () => void }) {
  const { m, errorOf } = useI18n();
  const d = m.deploy;
  const status = useDeployStatus(site.id);
  const create = useCreateSession(site.id);
  const target = status.data?.target;

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
      {target && (
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
            {status.data?.token ? (
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
          </div>
          {create.error && (
            <p role="alert" className="text-xs text-destructive">
              {errorOf(create.error)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
