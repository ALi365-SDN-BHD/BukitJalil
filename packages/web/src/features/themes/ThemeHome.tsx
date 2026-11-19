import type { Theme } from "@bukitjalil/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Palette, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BuildButton, BuildList } from "@/features/builds/builds";
import { HistorySection } from "@/features/changes/HistorySection";
import { ReasonList } from "@/features/sites/ReasonList";
import { StartConversation } from "@/features/sites/SiteHome";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { themeKey, themeProject } from "@/lib/project";
import { ApplyThemeDialog } from "./ApplyThemeDialog";
import { ExportThemeButton } from "./ExportThemeButton";
import { NewThemeDialog, useOpenCreatedTheme } from "./NewThemeDialog";

/** A theme project's home in the middle column (design 2): overview, builds, history, and where a conversation starts. */
export function ThemeHome({ theme }: { theme: Theme }) {
  const { m, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const project = themeProject(theme);
  const [applying, setApplying] = useState(false);
  const recheck = useMutation({
    mutationFn: () => api.recheckTheme(theme.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.theme(theme.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.themes });
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5" data-testid="theme-home">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold" data-testid="theme-title">
          {theme.name}
        </h1>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{m.themes.directory}</dt>
          <dd>
            <code className="text-xs" data-testid="theme-dir">
              themes/{theme.themeName}
            </code>
          </dd>
          <dt className="text-muted-foreground">{m.site.path}</dt>
          <dd>
            <code className="break-all text-xs">{theme.path}</code>
          </dd>
          <dt className="text-muted-foreground">{m.site.state}</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            {theme.readOnly ? <Badge tone="warn">{m.site.readOnly}</Badge> : <Badge tone="ok">{m.site.usable}</Badge>}
            {theme.configCheck && (
              <Badge tone={theme.configCheck === "ok" ? "ok" : theme.configCheck === "failed" ? "error" : "neutral"}>
                {m.site.configCheck[theme.configCheck]}
              </Badge>
            )}
          </dd>
        </dl>
        {theme.readOnly && <ReasonList reasons={theme.readOnly} />}
      </div>

      <div className="flex flex-col gap-2">
        {!theme.readOnly && <p className="text-xs text-muted-foreground">{m.themes.startHint}</p>}
        <div className="flex flex-wrap items-start gap-2">
          <StartConversation project={project} />
          <BuildButton project={themeKey(theme.id)} disabled={theme.readOnly !== null} />
          <Button size="sm" variant="outline" disabled={recheck.isPending} onClick={() => recheck.mutate()}>
            <RefreshCw className={recheck.isPending ? "animate-spin" : undefined} /> {m.site.recheck}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={theme.readOnly !== null}
            data-testid="apply-theme"
            onClick={() => setApplying(true)}
          >
            <Palette /> {m.themes.applyToSite}
          </Button>
          <ExportThemeButton theme={theme} />
        </div>
      </div>
      {applying && <ApplyThemeDialog theme={theme} onClose={() => setApplying(false)} />}
      {recheck.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorOf(recheck.error)}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{m.site.recentBuilds}</h2>
        <BuildList project={themeKey(theme.id)} />
      </section>

      <HistorySection project={project} />
    </div>
  );
}

/** Theme development with no theme project open: what it is, and the way to start one. */
export function ThemeWelcome() {
  const { m } = useI18n();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [creating, setCreating] = useState(false);
  const openCreated = useOpenCreatedTheme();
  return (
    <div className="flex flex-col gap-4 p-6 text-sm" data-testid="theme-welcome">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Palette className="size-5" /> {m.mode.theme}
        </h1>
        <p className="text-muted-foreground">{m.themes.welcome}</p>
      </header>
      {notice && (
        <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3" data-testid="notice">
          {notice}
        </p>
      )}
      <div>
        <Button size="sm" onClick={() => setCreating(true)} data-testid="welcome-new-theme">
          {m.themes.newTheme}
        </Button>
      </div>
      {creating && <NewThemeDialog onClose={() => setCreating(false)} onCreated={openCreated} />}
    </div>
  );
}
