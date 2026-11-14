import type { Site } from "@bukitjalil/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BuildButton, BuildList } from "@/features/builds/builds";
import { HistorySection } from "@/features/changes/HistorySection";
import { useCreateSession } from "@/features/chat/sessions";
import { DeploySection } from "@/features/deploys/DeploySection";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { LanguageMigrationCard } from "./LanguageMigrationCard";
import { ReasonList } from "./ReasonList";

/** "Start a new conversation" (plan 10.2), or why there can be none. */
function StartConversation({ site }: { site: Site }) {
  const { m, errorOf } = useI18n();
  const create = useCreateSession(site.id);
  if (site.readOnly) return <p className="self-center text-xs text-muted-foreground">{m.conversation.readOnlyHint}</p>;
  return (
    <div className="flex flex-col items-start gap-1">
      <Button size="sm" data-testid="start-conversation" disabled={create.isPending} onClick={() => create.mutate()}>
        <MessageSquare /> {m.conversation.start}
      </Button>
      {create.error && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(create.error)}
        </p>
      )}
    </div>
  );
}

/** Site home in the middle column (plan 10.2): overview, builds, and where a conversation starts. */
export function SiteHome({ site }: { site: Site }) {
  const { m, errorOf } = useI18n();
  const queryClient = useQueryClient();

  const refresh = (updated?: Site) => {
    if (updated) queryClient.setQueryData(keys.site(site.id), updated);
    void queryClient.invalidateQueries({ queryKey: keys.sites });
  };
  const recheck = useMutation({ mutationFn: () => api.recheck(site.id), onSuccess: refresh });
  const error = recheck.error;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5" data-testid="site-home">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold" data-testid="site-title">
          {site.name}
        </h1>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{m.site.path}</dt>
          <dd>
            <code className="break-all text-xs" data-testid="site-path">
              {site.path}
            </code>
          </dd>
          <dt className="text-muted-foreground">{m.site.branch}</dt>
          <dd>
            <code className="text-xs">{site.defaultBranch}</code>
          </dd>
          <dt className="text-muted-foreground">{m.site.state}</dt>
          <dd className="flex flex-wrap items-center gap-1.5" data-testid="site-state">
            {site.readOnly ? <Badge tone="warn">{m.site.readOnly}</Badge> : <Badge tone="ok">{m.site.usable}</Badge>}
            {site.configCheck && (
              <Badge tone={site.configCheck === "ok" ? "ok" : site.configCheck === "failed" ? "error" : "neutral"}>
                {m.site.configCheck[site.configCheck]}
              </Badge>
            )}
          </dd>
        </dl>
        {site.readOnly && <ReasonList reasons={site.readOnly} />}
      </div>

      <LanguageMigrationCard site={site} />

      <div className="flex flex-col gap-2">
        {!site.readOnly && <p className="text-xs text-muted-foreground">{m.conversation.startHint}</p>}
        <div className="flex flex-wrap items-start gap-2">
          <StartConversation site={site} />
          <BuildButton siteId={site.id} disabled={site.readOnly !== null} />
          <Button
            size="sm"
            variant="outline"
            data-testid="site-recheck"
            disabled={recheck.isPending}
            onClick={() => recheck.mutate()}
          >
            <RefreshCw className={recheck.isPending ? "animate-spin" : undefined} /> {m.site.recheck}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {errorOf(error)}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{m.site.recentBuilds}</h2>
        <BuildList siteId={site.id} />
      </section>

      <DeploySection site={site} />

      <HistorySection site={site} />
    </div>
  );
}
