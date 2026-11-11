import { type Appearance, type Locale, SUPPORTED_LOCALES } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Keyboard, MessageSquare, PanelRight, Server, Settings as SettingsIcon, SunMoon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { Link, Navigate, Route, Routes, useLocation, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { BuildBadge, useBuilds } from "@/features/builds/builds";
import { ChatView } from "@/features/chat/ChatView";
import { RightPanel } from "@/features/panels/RightPanel";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { ShortcutsDialog, useShortcutsKey } from "@/features/settings/ShortcutsDialog";
import { SetupGuide } from "@/features/sites/SetupGuide";
import { SiteHome } from "@/features/sites/SiteHome";
import { SiteList } from "@/features/sites/SiteList";
import { detectLocale, I18nProvider, localeNames, useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { useConnection } from "@/lib/events";
import { setAppearance } from "@/lib/theme";

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

  const appearance: Appearance | undefined = settings.data?.appearance;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    if (appearance) setAppearance(appearance);
  }, [appearance]);

  return (
    <I18nProvider locale={locale}>
      <Shell
        locale={locale}
        onLocaleChange={(next) => save.mutate({ locale: next })}
        appearance={appearance ?? "system"}
        onAppearanceChange={(next) => {
          setAppearance(next);
          // Painted at once; a failed save puts the saved choice back, as the select shows it.
          save.mutate({ appearance: next }, { onError: () => setAppearance(appearance ?? "system") });
        }}
        saveError={save.error}
      />
    </I18nProvider>
  );
}

function Shell({
  locale,
  onLocaleChange,
  appearance,
  onAppearanceChange,
  saveError,
}: {
  locale: Locale;
  onLocaleChange: (l: Locale) => void;
  appearance: Appearance;
  onAppearanceChange: (a: Appearance) => void;
  saveError: Error | null;
}) {
  const { m, t, errorOf } = useI18n();
  const layout = useDefaultLayout({ id: "bj-main", storage: safeLocalStorage() });
  const { siteId = null, sessionId = null } = useParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const narrow = useMediaQuery(NARROW);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useShortcutsKey(useCallback(() => setShortcutsOpen(true), []));
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

  const sitesColumn = (
    <>
      <SectionTitle icon={<Server className="size-4" />} title={m.sidebar.title} />
      <SiteList />
    </>
  );
  const conversationColumn = (
    <>
      <SectionTitle icon={<MessageSquare className="size-4" />} title={m.conversation.title} />
      <div className={`min-h-0 flex-1 ${sessionId ? "overflow-hidden" : "overflow-auto"}`}>
        {siteId === null ? (
          <Welcome onOpenSettings={() => setSettingsOpen(true)} />
        ) : site.isPending ? (
          <p className="p-6 text-sm text-muted-foreground">{m.common.loading}</p>
        ) : site.error ? (
          <p role="alert" className="p-6 text-sm text-destructive">
            {errorOf(site.error)}
          </p>
        ) : sessionId ? (
          <ChatView key={sessionId} site={site.data} sessionId={sessionId} />
        ) : (
          <SiteHome site={site.data} onOpenSettings={() => setSettingsOpen(true)} />
        )}
      </div>
    </>
  );
  const panelsColumn = (
    <RightPanel key={siteId ?? ""} siteId={site.data?.id ?? null} readOnly={!!site.data?.readOnly} />
  );

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-2 md:gap-3 md:px-3">
        <Link to="/" className="shrink-0 font-semibold">
          {m.app.name}
        </Link>
        {site.data && <SiteHeader siteId={site.data.id} name={site.data.name} />}
        <HealthBadge />
        <ConnectionNotice />
        <div className="ml-auto flex shrink-0 items-center gap-1 text-sm md:gap-2">
          {saveError && (
            <span role="alert" data-testid="save-error" className="text-xs text-destructive">
              {t(m.settings.saveFailed, { reason: errorOf(saveError) })}
            </span>
          )}
          <Globe className="hidden size-4 text-muted-foreground md:block" aria-hidden />
          <label htmlFor="locale" className="sr-only">
            {m.settings.language}
          </label>
          <select
            id="locale"
            data-testid="locale-select"
            className="max-w-24 rounded-md border bg-background px-1 py-1 text-xs md:max-w-none md:px-2 md:text-sm"
            value={locale}
            onChange={(e) => onLocaleChange(e.target.value as Locale)}
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {localeNames[l]}
              </option>
            ))}
          </select>
          <SunMoon className="hidden size-4 text-muted-foreground md:block" aria-hidden />
          <label htmlFor="appearance" className="sr-only">
            {m.settings.appearance}
          </label>
          <select
            id="appearance"
            data-testid="appearance-select"
            className="max-w-24 rounded-md border bg-background px-1 py-1 text-xs md:max-w-none md:px-2 md:text-sm"
            value={appearance}
            onChange={(e) => onAppearanceChange(e.target.value as Appearance)}
          >
            {(["system", "light", "dark"] as const).map((a) => (
              <option key={a} value={a}>
                {m.settings.appearances[a]}
              </option>
            ))}
          </select>
          <Button
            size="icon-sm"
            variant="ghost"
            className="hidden md:inline-flex"
            aria-label={m.shortcuts.open}
            title={`${m.shortcuts.open} (?)`}
            data-testid="open-shortcuts"
            onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard />
          </Button>
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
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {narrow ? (
        <NarrowLayout sites={sitesColumn} conversation={conversationColumn} panels={panelsColumn} />
      ) : (
        <Group
          orientation="horizontal"
          className="min-h-0 flex-1"
          defaultLayout={layout.defaultLayout}
          onLayoutChanged={layout.onLayoutChanged}
        >
          <Panel id="sites" defaultSize="18" minSize="12" className="flex flex-col border-r">
            {sitesColumn}
          </Panel>
          <Separator className="w-1 bg-border transition-colors hover:bg-primary/40" />
          <Panel id="conversation" defaultSize="47" minSize="25" className="flex flex-col">
            {conversationColumn}
          </Panel>
          <Separator className="w-1 bg-border transition-colors hover:bg-primary/40" />
          <Panel id="panels" defaultSize="35" minSize="20" className="flex flex-col border-l">
            {panelsColumn}
          </Panel>
        </Group>
      )}
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

/** Home page: the first-run guide, what to do first, and notices handed over by navigation (e.g. after removing a site). */
function Welcome({ onOpenSettings }: { onOpenSettings: () => void }) {
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
      <SetupGuide onOpenSettings={onOpenSettings} />
      <p className="text-muted-foreground" data-testid="conversation-placeholder">
        {m.conversation.placeholder}
      </p>
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
    <span data-testid="health" className={`hidden text-xs md:inline ${tone}`}>
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

/** Below this width the three columns do not fit side by side (plan M5 layer 3). */
const NARROW = "(max-width: 767px)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

type Column = "sites" | "conversation" | "panels";

/**
 * Narrow screens: one column at a time, picked from a tab bar. Opening a site or a conversation shows the
 * conversation column; opening a panel (?panel=, e.g. "View diff") shows the panels.
 */
function NarrowLayout({
  sites,
  conversation,
  panels,
}: {
  sites: React.ReactNode;
  conversation: React.ReactNode;
  panels: React.ReactNode;
}) {
  const { m } = useI18n();
  const { siteId = null, sessionId = null } = useParams();
  const location = useLocation();
  const [column, setColumn] = useState<Column>("conversation");
  useEffect(() => {
    // Runs when the site or conversation changes, not on every render.
    void siteId;
    void sessionId;
    setColumn("conversation");
  }, [siteId, sessionId]);
  // Any navigation that names a panel (also "View diff" while that panel is already in the URL).
  useEffect(() => {
    if (new URLSearchParams(location.search).has("panel")) setColumn("panels");
  }, [location.search]);
  const tabs: { id: Column; label: string; icon: React.ReactNode }[] = [
    { id: "sites", label: m.sidebar.title, icon: <Server className="size-4" /> },
    { id: "conversation", label: m.conversation.title, icon: <MessageSquare className="size-4" /> },
    { id: "panels", label: m.panel.title, icon: <PanelRight className="size-4" /> },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="narrow-layout">
      {/* All three stay mounted and laid out (invisible, not display:none), so a draft message, the loaded
          preview and the scroll position survive switching. */}
      <div className="relative min-h-0 flex-1">
        {(
          [
            ["sites", sites],
            ["conversation", conversation],
            ["panels", panels],
          ] as const
        ).map(([id, node]) => (
          <div key={id} className={`absolute inset-0 flex flex-col ${column === id ? "" : "invisible"}`}>
            {node}
          </div>
        ))}
      </div>
      <div className="grid shrink-0 grid-cols-3 border-t" aria-label={m.layout.columns} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={column === t.id}
            data-testid={`column-${t.id}`}
            onClick={() => setColumn(t.id)}
            className={`flex flex-col items-center gap-0.5 py-1.5 text-xs ${column === t.id ? "text-foreground" : "text-muted-foreground"}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
