import type { BukitResponse, Settings } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { IdentityFields } from "@/features/sites/identity";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { formatSize } from "@/lib/format";

/** Settings (plan 10.1): commit identity, Bukit status and install, custom Bukit path. */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { m } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={m.common.close} className="max-w-lg">
        <DialogTitle>{m.settings.title}</DialogTitle>
        {open && <SettingsForm />}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm() {
  const { m, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: keys.settings, queryFn: api.settings });
  // With no saved identity, the fields start from the global git identity, as in the new-site dialog.
  const missing = !!settings.data && (!settings.data.commitName || !settings.data.commitEmail);
  const global = useQuery({ queryKey: ["git-identity"], queryFn: api.identity, enabled: missing });
  const [draft, setDraft] = useState<{ name: string; email: string; bukitPath: string } | null>(null);
  useEffect(() => {
    if (!settings.data || draft || (missing && !global.isFetched)) return;
    setDraft({
      name: settings.data.commitName ?? global.data?.name ?? "",
      email: settings.data.commitEmail ?? global.data?.email ?? "",
      bukitPath: settings.data.bukitPath ?? "",
    });
  }, [settings.data, draft, missing, global.isFetched, global.data]);

  const save = useMutation({
    mutationFn: (d: NonNullable<typeof draft>) =>
      api.updateSettings({
        commitName: d.name.trim() || null,
        commitEmail: d.email.trim() || null,
        bukitPath: d.bukitPath.trim() || null,
      }),
    onSuccess: (data: Settings) => {
      queryClient.setQueryData(keys.settings, data);
      void queryClient.invalidateQueries({ queryKey: keys.bukit });
    },
  });

  if (!draft) return <p className="text-sm text-muted-foreground">{m.common.loading}</p>;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(draft);
      }}
    >
      <IdentityFields draft={{ name: draft.name, email: draft.email }} onChange={(d) => setDraft({ ...draft, ...d })} />
      <BukitSection />
      <Field label={m.settings.customPath} htmlFor="bukit-path" hint={m.settings.customPathHint}>
        <Input
          id="bukit-path"
          value={draft.bukitPath}
          placeholder="/usr/local/bin/bukit"
          onChange={(e) => setDraft({ ...draft, bukitPath: e.target.value })}
        />
      </Field>
      <div className="flex items-center justify-end gap-2">
        {save.error && (
          <span role="alert" className="mr-auto text-xs text-destructive">
            {errorOf(save.error)}
          </span>
        )}
        {save.isSuccess && !save.isPending && (
          <span className="mr-auto text-xs text-muted-foreground">{m.settings.saved}</span>
        )}
        <Button type="submit" size="sm" disabled={save.isPending} data-testid="settings-save">
          {save.isPending ? m.common.saving : m.common.save}
        </Button>
      </div>
    </form>
  );
}

const installing = (b: BukitResponse | undefined) =>
  b?.install.state === "downloading" || b?.install.state === "verifying";

function BukitSection() {
  const { m, t, errorOf, locale } = useI18n();
  const queryClient = useQueryClient();
  const bukit = useQuery({
    queryKey: keys.bukit,
    queryFn: api.bukit,
    refetchInterval: (q) => (installing(q.state.data) ? 1000 : false),
  });
  const install = useMutation({
    mutationFn: api.installBukit,
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.bukit }),
  });
  const [confirming, setConfirming] = useState(false);

  if (bukit.isPending) return <p className="text-sm text-muted-foreground">{m.common.loading}</p>;
  if (bukit.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorOf(bukit.error)}
      </p>
    );
  const { status, install: progress } = bukit.data;
  const s = m.settings;
  const stateText = t(s.bukitState[status.state], {
    version: status.version ?? "",
    source: status.source ? s.bukitSource[status.source] : "",
  });
  const tone = status.state === "ok" ? "ok" : status.state === "old" ? "warn" : "error";

  let progressText: string | null = null;
  if (progress.state === "downloading")
    progressText = t(s.downloading, {
      progress:
        progress.total !== null
          ? `${Math.floor((progress.received / progress.total) * 100)}%`
          : formatSize(progress.received, locale),
    });
  else if (progress.state === "verifying") progressText = s.verifying;
  else if (progress.state === "done") progressText = s.installDone;
  else if (progress.state === "failed") progressText = t(s.installFailed, { message: progress.message });

  return (
    <section className="flex flex-col gap-2 rounded-md border p-3" data-testid="bukit-section">
      <h3 className="text-sm font-medium">{s.bukit}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone} data-testid="bukit-state">
          {stateText}
        </Badge>
        {status.path && <code className="truncate text-xs text-muted-foreground">{status.path}</code>}
      </div>
      {status.customProblem && <p className="text-xs text-amber-700 dark:text-amber-400">{s.customProblem}</p>}
      {progressText && (
        <p className={`text-xs ${progress.state === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
          {progressText}
        </p>
      )}
      {install.error && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(install.error)}
        </p>
      )}
      {status.installable &&
        status.state !== "ok" &&
        (confirming ? (
          <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-2 text-xs">
            <p>{s.installConfirm}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="xs"
                onClick={() => {
                  setConfirming(false);
                  install.mutate();
                }}
              >
                {s.install}
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                {m.common.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start"
            disabled={installing(bukit.data) || install.isPending}
            onClick={() => setConfirming(true)}
            data-testid="bukit-install"
          >
            {installing(bukit.data) ? <Loader2 className="animate-spin" /> : <Download />}
            {s.install}
          </Button>
        ))}
    </section>
  );
}
