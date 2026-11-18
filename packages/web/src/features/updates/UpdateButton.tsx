import type { AppUpdateRelease, AppUpdateResponse } from "@bukitjalil/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { desktopBridge } from "@/lib/desktop";
import { formatSize } from "@/lib/format";

/** The update entry in the sidebar footer; only the desktop app can open the downloaded installer. */
export function UpdateButton() {
  const bridge = desktopBridge();
  if (!bridge) return null;
  return <UpdateControl />;
}

function UpdateControl() {
  const { m, t, locale, errorText } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const update = useQuery({
    queryKey: keys.update,
    queryFn: api.update,
    enabled: desktopBridge() !== null,
    retry: false,
    refetchInterval: (query) => {
      const phase = query.state.data?.state.phase;
      // A reload can join a check the old page started; poll until the server leaves that state.
      return phase === "downloading" || phase === "verifying" || phase === "checking" ? 1000 : false;
    },
  });

  useEffect(() => {
    let alive = true;
    const check = () => {
      const current = queryClient.getQueryData<AppUpdateResponse>(keys.update);
      if (current?.state.phase === "downloading") return;
      // The sidebar remounts when returning from settings; a recent answer is enough.
      if (current?.checkedAt && Date.now() - Date.parse(current.checkedAt) < 10 * 60_000) return;
      api.checkUpdate(false).then(
        (data) => {
          if (alive) queryClient.setQueryData(keys.update, data);
        },
        () => {},
      );
    };
    const first = window.setTimeout(check, 1500);
    const timer = window.setInterval(check, 6 * 60 * 60_000);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [queryClient]);

  const data = update.data;
  const state = data?.state;
  const release = state !== undefined && "release" in state ? state.release : undefined;
  const percent =
    state?.phase === "downloading" && state.total
      ? Math.min(100, Math.round((state.received / state.total) * 100))
      : null;

  const label = (() => {
    if (!state) return m.update.check;
    switch (state.phase) {
      case "checking":
        return m.update.checking;
      case "downloading":
        return percent === null ? m.update.downloading : t(m.update.downloading, { percent });
      case "verifying":
        return m.update.verifying;
      case "downloaded":
        return m.update.install;
      case "available":
        return m.update.available;
      case "error":
        return m.update.retry;
      default:
        return m.update.check;
    }
  })();
  const spinning = state?.phase === "checking" || state?.phase === "downloading" || state?.phase === "verifying";
  const highlighted = state?.phase === "available" || state?.phase === "downloaded";
  // Idle is the common case; an icon keeps the whole version visible in the narrow sidebar. A real state
  // (or an error) gets text so the action is clear.
  const showLabel = state !== undefined && state.phase !== "idle" && state.phase !== "checking";
  const installDetail = (() => {
    switch (release?.asset.format) {
      case "dmg":
        return m.update.formatDmg;
      case "zip":
        return m.update.formatZip;
      case "exe":
        return m.update.formatExe;
      case "appimage":
        return m.update.formatAppImage;
      case "deb":
        return m.update.formatDeb;
      default:
        return m.update.downloadedDetail;
    }
  })();

  const run = async (action: () => Promise<AppUpdateResponse>) => {
    setBusy(true);
    try {
      queryClient.setQueryData(keys.update, await action());
    } catch {
      // The dialog keeps the last known state; the button can be pressed again.
    } finally {
      setBusy(false);
    }
  };

  const check = () => {
    setOpened(false);
    void run(api.checkUpdate);
  };
  const download = () => {
    setOpened(false);
    void run(api.downloadUpdate);
  };
  const openInstaller = async () => {
    setBusy(true);
    try {
      const next = await api.openUpdate();
      queryClient.setQueryData(keys.update, next);
      setOpened(next.state.phase === "downloaded");
    } catch {
      setOpened(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="relative h-7 shrink-0 gap-1 px-1.5 text-xs"
        aria-label={label}
        title={label}
        data-testid="app-update"
        onClick={() => {
          setOpen(true);
          if (!state || state.phase === "idle") check();
        }}
      >
        {spinning ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : state?.phase === "downloaded" ? (
          <Download className="size-3.5" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        {showLabel && label}
        {highlighted && (
          <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-sky-500" aria-hidden="true" />
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={m.common.close}>
          <DialogTitle>{m.update.title}</DialogTitle>
          {!data || !state ? (
            <DialogDescription>{m.common.loading}</DialogDescription>
          ) : state.phase === "checking" ? (
            <DialogDescription className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> {m.update.checking}
            </DialogDescription>
          ) : state.phase === "idle" ? (
            <>
              <DialogDescription>{m.update.upToDate}</DialogDescription>
              <p className="text-xs text-muted-foreground">
                {m.update.current}: {data.currentVersion}
              </p>
              <div className="flex justify-end">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {m.common.close}
                </Button>
              </div>
            </>
          ) : state.phase === "available" || state.phase === "error" ? (
            <>
              <DialogDescription>
                {state.phase === "available"
                  ? t(m.update.availableTitle, { version: state.release.version })
                  : errorText(state.code)}
              </DialogDescription>
              {release && <ReleaseDetails release={release} currentVersion={data.currentVersion} />}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {m.update.later}
                </Button>
                {state.phase === "available" || (release && state.operation !== "open") ? (
                  <Button disabled={busy} onClick={download} data-testid="app-update-download">
                    {m.update.download}
                  </Button>
                ) : state.phase === "error" && state.operation === "open" && release ? (
                  <Button disabled={busy} onClick={openInstaller} data-testid="app-update-open">
                    {m.update.open}
                  </Button>
                ) : (
                  <Button disabled={busy} onClick={check} data-testid="app-update-check">
                    {m.update.retry}
                  </Button>
                )}
              </div>
            </>
          ) : state.phase === "downloading" || state.phase === "verifying" ? (
            <>
              <DialogDescription>
                {state.phase === "downloading" ? m.update.downloadingDetail : m.update.verifyingDetail}
              </DialogDescription>
              {state.phase === "downloading" && (
                <div className="flex flex-col gap-2">
                  <div className="h-1.5 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full bg-primary transition-[width]"
                      style={{ width: `${percent ?? 0}%` }}
                      data-testid="app-update-progress"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(state.received, locale)}
                    {state.total ? ` / ${formatSize(state.total, locale)}` : ""}
                  </p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {m.update.later}
                </Button>
                {state.phase === "downloading" && (
                  <Button variant="outline" disabled={busy} onClick={() => void run(api.cancelUpdate)}>
                    {m.update.cancel}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <DialogDescription>{opened ? m.update.opened : installDetail}</DialogDescription>
              {release && <ReleaseDetails release={release} currentVersion={data.currentVersion} />}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {m.update.later}
                </Button>
                <Button disabled={busy} data-testid="app-update-open" onClick={openInstaller}>
                  {m.update.open}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReleaseDetails({ release, currentVersion }: { release: AppUpdateRelease; currentVersion: string }) {
  const { m, locale } = useI18n();
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3 text-xs text-muted-foreground">
      <p>
        {m.update.current}: <span className="text-foreground">{currentVersion}</span>
      </p>
      <p className="flex items-center gap-2">
        {m.update.latest}: <span className="text-foreground">{release.version}</span>
        {release.version.includes("-") && <Badge tone="warn">{m.update.beta}</Badge>}
      </p>
      <p>
        {m.update.size}: <span className="text-foreground">{formatSize(release.asset.size, locale)}</span>
      </p>
      <a className="underline hover:text-foreground" href={release.pageUrl} target="_blank" rel="noreferrer">
        {m.update.releaseNotes}
      </a>
    </div>
  );
}
