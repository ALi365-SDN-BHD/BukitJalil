import type { Site } from "@bukitjalil/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, MessageSquare, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { BuildButton, BuildList } from "@/features/builds/builds";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { ReasonList } from "./ReasonList";

/** Site home in the middle column (plan 10.2) until conversations arrive in M3. */
export function SiteHome({ site }: { site: Site }) {
  const { m, t, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = (updated?: Site) => {
    if (updated) queryClient.setQueryData(keys.site(site.id), updated);
    void queryClient.invalidateQueries({ queryKey: keys.sites });
  };
  const recheck = useMutation({ mutationFn: () => api.recheck(site.id), onSuccess: refresh });
  const archive = useMutation({
    mutationFn: () => api.patchSite(site.id, { archived: !site.archived }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api.removeSite(site.id),
    onSuccess: ({ leftovers }) => {
      setConfirmRemove(false);
      queryClient.removeQueries({ queryKey: keys.site(site.id) });
      void queryClient.invalidateQueries({ queryKey: keys.sites });
      // The page goes away with the site, so the home page shows what is left to clean up.
      navigate(
        "/",
        leftovers.length > 0 ? { state: { notice: t(m.site.leftovers, { items: leftovers.join(", ") }) } } : {},
      );
    },
  });
  const error = recheck.error ?? archive.error;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5" data-testid="site-home">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold" data-testid="site-title">
          {site.name}
        </h1>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{m.site.path}</dt>
          <dd>
            <code className="break-all text-xs">{site.path}</code>
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

      <div className="flex flex-wrap gap-2">
        <BuildButton siteId={site.id} disabled={site.readOnly !== null} />
        <Button size="sm" variant="outline" disabled={recheck.isPending} onClick={() => recheck.mutate()}>
          <RefreshCw className={recheck.isPending ? "animate-spin" : undefined} /> {m.site.recheck}
        </Button>
        <Button size="sm" variant="outline" disabled={archive.isPending} onClick={() => archive.mutate()}>
          {site.archived ? <ArchiveRestore /> : <Archive />} {site.archived ? m.site.unarchive : m.site.archive}
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmRemove(true)}>
          <Trash2 /> {m.site.remove}
        </Button>
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

      <section className="flex items-start gap-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        <MessageSquare className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{m.conversation.comingSoon}</p>
      </section>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent closeLabel={m.common.close}>
          <DialogTitle>{t(m.site.removeTitle, { name: site.name })}</DialogTitle>
          <DialogDescription>{t(m.site.removeBody, { path: site.path })}</DialogDescription>
          {remove.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorOf(remove.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              {m.common.cancel}
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {m.site.removeConfirm}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
