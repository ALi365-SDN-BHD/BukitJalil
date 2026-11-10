import type { InstallProgress, Settings } from "@bukitjalil/shared";
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
import { ModelSection } from "./ModelSection";

/**
 * Settings (plan 10.1): the AI model and its key, commit identity, Bukit status and install, custom Bukit
 * path, rg status and install.
 */
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
      <ModelSection />
      <IdentityFields draft={{ name: draft.name, email: draft.email }} onChange={(d) => setDraft({ ...draft, ...d })} />
      <BukitSection />
      <RgSection />
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

const installing = (b: { install: InstallProgress } | undefined) =>
  b?.install.state === "downloading" || b?.install.state === "verifying";

function BukitSection() {
  const { m, t, errorOf } = useI18n();
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
      <InstallControl
        progress={progress}
        offer={status.installable && (status.state !== "ok" || status.upgradable)}
        label={s.install}
        confirm={s.installConfirm}
        mutation={install}
        testId="bukit-install"
      />
    </section>
  );
}

/** ripgrep for the AI's grep tool (plan 6.3): pinned version, checked by SHA-256. */
function RgSection() {
  const { m, t, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const rg = useQuery({
    queryKey: keys.rg,
    queryFn: api.rg,
    refetchInterval: (q) => (installing(q.state.data) ? 1000 : false),
  });
  const install = useMutation({
    mutationFn: api.installRg,
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.rg }),
  });

  if (rg.isPending) return <p className="text-sm text-muted-foreground">{m.common.loading}</p>;
  if (rg.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorOf(rg.error)}
      </p>
    );
  const { status, install: progress } = rg.data;
  const s = m.settings;
  const state = status.installable ? status.state : "unsupported";
  return (
    <section className="flex flex-col gap-2 rounded-md border p-3" data-testid="rg-section">
      <h3 className="text-sm font-medium">{s.rg}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={state === "ok" ? "ok" : state === "missing" ? "warn" : "error"} data-testid="rg-state">
          {t(s.rgState[state], { version: status.version })}
        </Badge>
      </div>
      {state !== "ok" && (
        <p className="text-xs text-muted-foreground">{status.installable ? s.rgHint : s.rgUnavailable}</p>
      )}
      <InstallControl
        progress={progress}
        offer={status.installable && status.state !== "ok"}
        label={t(s.rgInstall, { version: status.version })}
        confirm={t(s.rgInstallConfirm, { version: status.version })}
        mutation={install}
        testId="rg-install"
      />
    </section>
  );
}

/** Install progress, then a button that asks once before it starts the download. */
function InstallControl({
  progress,
  offer,
  label,
  confirm,
  mutation,
  testId,
}: {
  progress: InstallProgress;
  /** Show the install button: a package exists and the installed copy is missing or wrong. */
  offer: boolean;
  label: string;
  confirm: string;
  mutation: { mutate: () => void; isPending: boolean; error: unknown };
  testId: string;
}) {
  const { m, t, errorOf, locale } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const s = m.settings;
  const busy = installing({ install: progress });

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
    <>
      {progressText && (
        <p
          className={`text-xs ${progress.state === "failed" ? "text-destructive" : "text-muted-foreground"}`}
          data-testid={`${testId}-progress`}
        >
          {progressText}
        </p>
      )}
      {mutation.error != null && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(mutation.error)}
        </p>
      )}
      {offer &&
        (confirming ? (
          <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-2 text-xs">
            <p>{confirm}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="xs"
                onClick={() => {
                  setConfirming(false);
                  mutation.mutate();
                }}
                data-testid={`${testId}-confirm`}
              >
                {label}
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
            disabled={busy || mutation.isPending}
            onClick={() => setConfirming(true)}
            data-testid={testId}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Download />}
            {label}
          </Button>
        ))}
    </>
  );
}
