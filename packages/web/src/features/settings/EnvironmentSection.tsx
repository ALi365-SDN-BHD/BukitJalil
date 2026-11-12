import type { GitGuideCommand, InstallProgress } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, Loader2, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { formatSize } from "@/lib/format";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

/** Pi ships inside the app; a newer release is installed by updating BukitJalil itself. */
const PI_RELEASES = "https://github.com/ALi365-SDN-BHD/BukitJalil/releases/latest";

/** Bukit, ripgrep and Pi (plan 8.1, 6.3). */
export function EnvironmentSection() {
  const { m } = useI18n();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const checkUpdates = async () => {
    setChecking(true);
    try {
      const [bukit, rg, git, pi] = await Promise.all([api.bukit(true, true), api.rg(), api.git(true), api.pi(true)]);
      queryClient.setQueryData(keys.bukit, bukit);
      queryClient.setQueryData(keys.rg, rg);
      queryClient.setQueryData(keys.git, git);
      queryClient.setQueryData(keys.pi, pi);
    } catch {
      // The rows show their own errors; a failed check keeps the last known versions.
    } finally {
      setChecking(false);
    }
  };

  return (
    <SettingsSection
      title={m.settings.sections.environment}
      action={
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={checking}
          onClick={checkUpdates}
          data-testid="check-updates"
        >
          <RefreshCw className={checking ? "animate-spin" : undefined} />
          {checking ? m.settings.checkingUpdates : m.settings.checkUpdates}
        </Button>
      }
    >
      <BukitRow />
      <RgRow />
      <PiRow />
      <GitRow />
    </SettingsSection>
  );
}

/** Git is required for history, apply and restore; Homebrew can install or update it without admin rights. */
function GitRow() {
  const { m, t, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const [guide, setGuide] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const git = useQuery({
    queryKey: keys.git,
    queryFn: () => api.git(),
    refetchInterval: (q) => (q.state.data?.install.state === "running" ? 1000 : false),
  });
  const check = useMutation({
    mutationFn: () => api.git(true),
    onSuccess: (data) => queryClient.setQueryData(keys.git, data),
  });
  const install = useMutation({
    mutationFn: api.installGit,
    onSuccess: () => {
      setConfirm(false);
      void queryClient.invalidateQueries({ queryKey: keys.git });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });

  if (git.isPending) return <SettingsRow testId="git-section" label={m.settings.git} description={m.common.loading} />;
  if (git.error)
    return (
      <SettingsRow
        testId="git-section"
        label={m.settings.git}
        description={
          <span role="alert" className="text-destructive">
            {errorOf(git.error)}
          </span>
        }
      />
    );

  const { status, install: progress } = git.data;
  const s = m.settings;
  const installed = status.version ?? s.notInstalled;
  const latest =
    status.latestVersion ?? (status.packageManager && !status.installable ? s.gitSystemManaged : s.versionUnknown);
  const offer = status.state === "missing" || status.updatable;
  const actionLabel =
    status.state === "missing"
      ? status.latestVersion
        ? t(s.gitInstall, { version: status.latestVersion })
        : s.gitInstallShort
      : status.latestVersion
        ? t(s.gitUpdate, { version: status.latestVersion })
        : s.gitUpdateShort;
  const windowsDownload = status.platform === "win32" && status.installable;
  const confirmText =
    status.state === "missing"
      ? t(windowsDownload ? s.gitInstallConfirmWindows : s.gitInstallConfirm, { version: status.latestVersion ?? "" })
      : t(windowsDownload ? s.gitUpdateConfirmWindows : s.gitUpdateConfirm, { version: status.latestVersion ?? "" });
  let badge: ReactNode;
  if (status.state === "missing")
    badge = (
      <Badge tone="warn" data-testid="git-state">
        {s.notInstalled}
      </Badge>
    );
  else if (status.state === "broken")
    badge = (
      <Badge tone="error" data-testid="git-state">
        {s.gitBroken}
      </Badge>
    );
  else if (status.updatable)
    badge = (
      <Badge tone="warn" data-testid="git-state">
        {t(s.updateAvailable, { version: status.latestVersion ?? "" })}
      </Badge>
    );
  else if (status.state === "too_old")
    badge = (
      <Badge tone="warn" data-testid="git-state">
        {s.gitTooOldShort}
      </Badge>
    );
  else if (status.latestVersion === null)
    badge = (
      <Badge tone="warn" data-testid="git-state">
        {s.gitCheckFailed}
      </Badge>
    );
  else
    badge = (
      <Badge tone="ok" data-testid="git-state">
        {s.upToDate}
      </Badge>
    );

  let progressText: string | null = null;
  if (progress.state === "running") progressText = s.gitInstallRunning;
  else if (progress.state === "done") progressText = t(s.gitInstallDone, { version: progress.version ?? "" });
  else if (progress.state === "failed") progressText = t(s.gitInstallFailed, { message: progress.message });

  return (
    <>
      <SettingsRow
        testId="git-section"
        label={s.git}
        description={
          <span className="flex flex-col gap-1">
            <span>
              {s.installedVersion}:{" "}
              <strong className="font-medium text-foreground" data-testid="git-version">
                {installed}
              </strong>
            </span>
            <span>
              {s.latestVersion}:{" "}
              <strong className="font-medium text-foreground" data-testid="git-latest">
                {latest}
              </strong>
            </span>
            {status.source && (
              <span>
                {s.gitSource}: {s.gitSources[status.source]}
              </span>
            )}
            {badge}
            {progressText && (
              <span
                className={progress.state === "failed" ? "text-destructive" : "text-muted-foreground"}
                data-testid="git-install-progress"
              >
                {progressText}
              </span>
            )}
          </span>
        }
      >
        <div className="flex items-center gap-2">
          {offer && status.installable && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => setConfirm(true)}
              data-testid="git-install"
            >
              <Download /> {actionLabel}
            </Button>
          )}
          {((offer && !status.installable) || !offer) && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => setGuide(true)}
              data-testid="git-guide-open"
            >
              {offer ? actionLabel : s.gitGuideOpen}
            </Button>
          )}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={s.gitCheck}
            title={s.gitCheck}
            disabled={check.isPending}
            onClick={() => check.mutate()}
            data-testid="git-check"
          >
            <RefreshCw className={check.isPending ? "animate-spin" : undefined} />
          </Button>
        </div>
      </SettingsRow>
      {confirm && (
        <Dialog open onOpenChange={(open) => !open && setConfirm(false)}>
          <DialogContent closeLabel={m.common.close}>
            <DialogTitle>{s.gitConfirmTitle}</DialogTitle>
            <DialogDescription>{confirmText}</DialogDescription>
            {install.error && (
              <p role="alert" className="text-xs text-destructive">
                {errorOf(install.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                {m.common.cancel}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={install.isPending}
                onClick={() => install.mutate()}
                data-testid="git-install-confirm"
              >
                {install.isPending ? <Loader2 className="animate-spin" /> : <Download />}
                {actionLabel}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <GitGuide
        open={guide}
        onOpenChange={setGuide}
        status={`${s.installedVersion}: ${installed} · ${s.latestVersion}: ${latest}`}
        commands={status.guide}
        onRecheck={() => check.mutate()}
      />
    </>
  );
}

/** Manual commands, for systems where Homebrew cannot install Git. */
function GitGuide({
  open,
  onOpenChange,
  status,
  commands,
  onRecheck,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: string;
  commands: GitGuideCommand[];
  onRecheck: () => void;
}) {
  const { m } = useI18n();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
    } catch {
      // The command is still selectable; the clipboard is a convenience.
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={m.common.close} className="max-w-2xl" data-testid="git-guide">
        <DialogTitle>{m.settings.gitGuideTitle}</DialogTitle>
        <DialogDescription>{m.settings.gitGuideHint}</DialogDescription>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto text-sm">
          <p className="text-muted-foreground" data-testid="git-guide-status">
            {status}
          </p>
          {commands.length === 0 ? (
            <p className="text-xs text-muted-foreground">{m.settings.gitNoGuide}</p>
          ) : (
            commands.map(({ title, command }) => (
              <div key={title} className="flex flex-col gap-1">
                <span className="font-medium">{title}</span>
                <div className="flex items-start gap-2">
                  <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-2 text-xs">
                    <code>{command}</code>
                  </pre>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => void copy(command)}
                    data-testid="git-copy"
                  >
                    {copied === command ? <Check /> : <Copy />}
                    {copied === command ? m.settings.gitCopied : m.settings.gitCopy}
                  </Button>
                </div>
              </div>
            ))
          )}
          <p className="text-xs text-muted-foreground">{m.settings.gitRestartHint}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onRecheck} data-testid="git-recheck">
            <RefreshCw /> {m.settings.gitRecheck}
          </Button>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {m.common.close}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const installing = (b: { install: InstallProgress } | undefined) =>
  b?.install.state === "downloading" || b?.install.state === "verifying";

function BukitRow() {
  const { m, t, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const bukit = useQuery({
    queryKey: keys.bukit,
    queryFn: () => api.bukit(),
    refetchInterval: (q) => (installing(q.state.data) ? 1000 : false),
  });
  const install = useMutation({
    mutationFn: api.installBukit,
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.bukit }),
  });

  if (bukit.isPending)
    return <SettingsRow testId="bukit-section" label={m.settings.bukit} description={m.common.loading} />;
  if (bukit.error)
    return (
      <SettingsRow
        testId="bukit-section"
        label={m.settings.bukit}
        description={
          <span role="alert" className="text-destructive">
            {errorOf(bukit.error)}
          </span>
        }
      />
    );
  const { status, install: progress } = bukit.data;
  const s = m.settings;
  const latest = status.latestVersion;
  const stateText = t(s.bukitState[status.state], {
    version: status.version ?? "",
    latest,
  });
  const tone = status.state === "ok" ? "ok" : status.state === "old" ? "warn" : "error";
  const installed = status.state === "missing" ? s.notInstalled : (status.version ?? s.versionUnknown);
  const upToDate = status.state === "ok" && !status.upgradable;
  const offer = status.installable && (status.state !== "ok" || status.upgradable);

  return (
    <SettingsRow
      testId="bukit-section"
      label={s.bukit}
      description={
        <span className="flex flex-col gap-1">
          <span>
            {s.installedVersion}:{" "}
            <strong className="font-medium text-foreground" data-testid="bukit-version">
              {installed}
            </strong>
          </span>
          <span>
            {s.latestVersion}:{" "}
            <strong className="font-medium text-foreground" data-testid="bukit-latest">
              {latest}
            </strong>
          </span>
          {status.path && <code className="break-all text-xs">{status.path}</code>}
          {!status.installable && status.state !== "ok" && <span>{s.bukitUnavailable}</span>}
          {upToDate ? (
            <Badge tone="ok" className="self-start" data-testid="bukit-state">
              {s.upToDate}
            </Badge>
          ) : status.upgradable ? (
            <Badge tone="warn" className="self-start" data-testid="bukit-state">
              {t(s.updateAvailable, { version: latest })}
            </Badge>
          ) : (
            <Badge tone={tone} className="self-start" data-testid="bukit-state">
              {stateText}
            </Badge>
          )}
        </span>
      }
    >
      {offer && (
        <InstallControl
          progress={progress}
          offer
          label={t(s.install, { version: latest })}
          confirm={t(s.installConfirm, { version: latest })}
          mutation={install}
          testId="bukit-install"
        />
      )}
    </SettingsRow>
  );
}

/** ripgrep for the AI's grep tool (plan 6.3): pinned version, checked by SHA-256. */
function RgRow() {
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

  if (rg.isPending) return <SettingsRow testId="rg-section" label={m.settings.rg} description={m.common.loading} />;
  if (rg.error)
    return (
      <SettingsRow
        testId="rg-section"
        label={m.settings.rg}
        description={
          <span role="alert" className="text-destructive">
            {errorOf(rg.error)}
          </span>
        }
      />
    );
  const { status, install: progress } = rg.data;
  const s = m.settings;
  const state = status.installable ? status.state : "unsupported";
  const installed =
    state === "ok" ? status.version : state === "missing" || !status.installable ? s.notInstalled : s.versionUnknown;
  const offer = status.installable && status.state !== "ok";
  return (
    <SettingsRow
      testId="rg-section"
      label={s.rg}
      description={
        <span className="flex flex-col gap-1">
          <span>
            {s.installedVersion}:{" "}
            <strong className="font-medium text-foreground" data-testid="rg-version">
              {installed}
            </strong>
          </span>
          <span>
            {s.latestVersion}:{" "}
            <strong className="font-medium text-foreground" data-testid="rg-latest">
              {status.version}
            </strong>
          </span>
          {state === "ok" ? (
            <Badge tone="ok" className="self-start" data-testid="rg-state">
              {s.upToDate}
            </Badge>
          ) : (
            <Badge tone={state === "missing" ? "warn" : "error"} className="self-start" data-testid="rg-state">
              {t(s.rgState[state], { version: status.version })}
            </Badge>
          )}
          {state !== "ok" && <span>{status.installable ? s.rgHint : s.rgUnavailable}</span>}
        </span>
      }
    >
      {offer && (
        <InstallControl
          progress={progress}
          offer
          label={t(s.rgInstall, { version: status.version })}
          confirm={t(s.rgInstallConfirm, { version: status.version })}
          mutation={install}
          testId="rg-install"
        />
      )}
    </SettingsRow>
  );
}

/** The Pi runtime inside the app. An update arrives with a new BukitJalil release, not by replacing files. */
function PiRow() {
  const { m, t, errorOf } = useI18n();
  const s = m.settings;
  const pi = useQuery({ queryKey: keys.pi, queryFn: () => api.pi() });

  if (pi.isPending) return <SettingsRow testId="pi-section" label={s.pi} description={m.common.loading} />;
  if (pi.error)
    return (
      <SettingsRow
        testId="pi-section"
        label={s.pi}
        description={
          <span role="alert" className="text-destructive">
            {errorOf(pi.error)}
          </span>
        }
      />
    );

  const { version, latestVersion, updateAvailable } = pi.data;
  return (
    <SettingsRow
      testId="pi-section"
      label={s.pi}
      description={
        <span className="flex flex-col gap-1">
          <span>
            {s.installedVersion}:{" "}
            <strong className="font-medium text-foreground" data-testid="pi-version">
              {version}
            </strong>
          </span>
          <span>
            {s.latestVersion}:{" "}
            <strong className="font-medium text-foreground" data-testid="pi-latest">
              {latestVersion ?? s.versionUnknown}
            </strong>
          </span>
          {updateAvailable ? (
            <Badge tone="warn" className="self-start" data-testid="pi-state">
              {t(s.updateAvailable, { version: latestVersion ?? "" })}
            </Badge>
          ) : latestVersion ? (
            <Badge tone="ok" className="self-start" data-testid="pi-state">
              {s.upToDate}
            </Badge>
          ) : (
            <Badge tone="warn" className="self-start" data-testid="pi-state">
              {s.piCheckFailed}
            </Badge>
          )}
          <span>{s.piHint}</span>
        </span>
      }
    >
      {updateAvailable && (
        <Button asChild size="sm" variant="outline">
          <a href={PI_RELEASES} target="_blank" rel="noreferrer" data-testid="pi-update">
            {s.updateApp}
          </a>
        </Button>
      )}
    </SettingsRow>
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
            className="self-start md:self-end"
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
