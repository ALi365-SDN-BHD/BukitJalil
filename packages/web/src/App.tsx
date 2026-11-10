import { type Locale, SUPPORTED_LOCALES } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, MessageSquare, Server, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { Link, Navigate, Route, Routes, useLocation, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { BuildBadge, useBuilds } from "@/features/builds/builds";
import { ChatView } from "@/features/chat/ChatView";
import { RightPanel } from "@/features/panels/RightPanel";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { SiteHome } from "@/features/sites/SiteHome";
import { SiteList } from "@/features/sites/SiteList";
import { detectLocale, I18nProvider, localeNames, useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { useConnection } from "@/lib/events";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/sites/:siteId" element={<Root />} />
      <Route path="/sites/:siteId/sessions/:sessionId" element={<Root />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Root() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: keys.settings, queryFn: api.settings, retry: false });
  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: (data) => queryClient.setQueryData(keys.settings, data),
  });
  const locale: Locale = settings.data?.locale ?? detectLocale(navigator.languages);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nProvider locale={locale}>
      <Shell locale={locale} onLocaleChange={(next) => save.mutate({ locale: next })} saveError={save.error} />
    </I18nProvider>
  );
}

function Shell({
  locale,
  onLocaleChange,
  saveError,
}: {
  locale: Locale;
  onLocaleChange: (l: Locale) => void;
  saveError: Error | null;
}) {
  const { m, t, errorOf } = useI18n();
  const layout = useDefaultLayout({ id: "bj-main", storage: safeLocalStorage() });
  const { siteId = null, sessionId = null } = useParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const site = useQuery({
    queryKey: keys.site(siteId ?? ""),
    queryFn: () => api.site(siteId ?? ""),
    enabled: siteId !== null,
    retry: false,
  });

  // Record the visit so the sidebar lists recently opened sites first (plan 10.1).
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!siteId) return;
    api.openSite(siteId).then(
      () => queryClient.invalidateQueries({ queryKey: keys.sites }),
      () => {},
    );
  }, [siteId, queryClient]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
        <Link to="/" className="font-semibold">
          {m.app.name}
        </Link>
        {site.data && <SiteHeader siteId={site.data.id} name={site.data.name} />}
        <HealthBadge />
        <ConnectionNotice />
        <div className="ml-auto flex items-center gap-2 text-sm">
          {saveError && (
            <span role="alert" data-testid="save-error" className="text-xs text-destructive">
              {t(m.settings.saveFailed, { reason: errorOf(saveError) })}
            </span>
          )}
          <Globe className="size-4 text-muted-foreground" aria-hidden />
          <label htmlFor="locale" className="sr-only">
            {m.settings.language}
          </label>
          <select
            id="locale"
            data-testid="locale-select"
            className="rounded-md border bg-background px-2 py-1"
            value={locale}
            onChange={(e) => onLocaleChange(e.target.value as Locale)}
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {localeNames[l]}
              </option>
            ))}
          </select>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={m.settings.open}
            title={m.settings.open}
            data-testid="open-settings"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon />
          </Button>
        </div>
      </header>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
      >
        <Panel id="sites" defaultSize="18" minSize="12" className="flex flex-col border-r">
          <SectionTitle icon={<Server className="size-4" />} title={m.sidebar.title} />
          <SiteList />
        </Panel>
        <Separator className="w-1 bg-border transition-colors hover:bg-primary/40" />
        <Panel id="conversation" defaultSize="47" minSize="25" className="flex flex-col">
          <SectionTitle icon={<MessageSquare className="size-4" />} title={m.conversation.title} />
          <div className={`min-h-0 flex-1 ${sessionId ? "overflow-hidden" : "overflow-auto"}`}>
            {siteId === null ? (
              <Welcome />
            ) : site.isPending ? (
              <p className="p-6 text-sm text-muted-foreground">{m.common.loading}</p>
            ) : site.error ? (
              <p role="alert" className="p-6 text-sm text-destructive">
                {errorOf(site.error)}
              </p>
            ) : sessionId ? (
              <ChatView key={sessionId} site={site.data} sessionId={sessionId} />
            ) : (
              <SiteHome site={site.data} />
            )}
          </div>
        </Panel>
        <Separator className="w-1 bg-border transition-colors hover:bg-primary/40" />
        <Panel id="panels" defaultSize="35" minSize="20" className="flex flex-col border-l">
          <RightPanel key={siteId ?? ""} siteId={site.data?.id ?? null} readOnly={!!site.data?.readOnly} />
        </Panel>
      </Group>
    </div>
  );
}

/** Site name and the state of its newest build, next to the app name. */
function SiteHeader({ siteId, name }: { siteId: string; name: string }) {
  const builds = useBuilds(siteId);
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <span className="text-muted-foreground">/</span>
      <span className="truncate font-medium" data-testid="header-site-title">
        {name}
      </span>
      {builds.latest && <BuildBadge build={builds.latest} />}
    </div>
  );
}

/** Home page: what to do first, and notices handed over by navigation (e.g. after removing a site). */
function Welcome() {
  const { m } = useI18n();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  return (
    <div className="flex flex-col gap-4 p-6 text-sm">
      {notice && (
        <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3" data-testid="notice">
          {notice}
        </p>
      )}
      <p className="text-muted-foreground">{m.conversation.placeholder}</p>
    </div>
  );
}

/** Shown only while the event stream is down: conversations and builds stop updating then. */
function ConnectionNotice() {
  const { m } = useI18n();
  const connection = useConnection();
  if (connection !== "lost") return null;
  return (
    <span role="status" data-testid="connection-lost" className="text-xs text-destructive">
      {m.chat.connection.lost}
    </span>
  );
}

function HealthBadge() {
  const { m, t, errorOf } = useI18n();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });
  let text = m.status.checking;
  let tone = "text-muted-foreground";
  if (health.error) {
    text = errorOf(health.error);
    tone = "text-destructive";
  } else if (health.data) {
    const { git } = health.data;
    if (git.ok) text = t(m.status.gitOk, { version: git.version ?? "" });
    else if (git.problem === "too_old") text = t(m.status.gitTooOld, { version: git.version ?? "" });
    else text = m.status.gitMissing;
    tone = git.ok ? "text-muted-foreground" : "text-destructive";
  }
  return (
    <span data-testid="health" className={`text-xs ${tone}`}>
      {text}
    </span>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-sm font-medium">
      {icon}
      {title}
    </div>
  );
}

/** localStorage can throw (privacy modes); layout persistence is only a convenience. */
function safeLocalStorage(): Pick<Storage, "getItem" | "setItem"> {
  return {
    getItem: (k) => {
      try {
        return window.localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        // ignore
      }
    },
  };
}
