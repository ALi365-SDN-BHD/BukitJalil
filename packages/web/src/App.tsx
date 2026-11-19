import type { Appearance, Locale } from "@bukitjalil/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, PanelRight, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router";
import { ChatView } from "@/features/chat/ChatView";
import { RightPanel } from "@/features/panels/RightPanel";
import { useSecretsSettled } from "@/features/settings/SecretsNotice";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { ShortcutsDialog, useShortcutsKey } from "@/features/settings/ShortcutsDialog";
import { SetupGuide } from "@/features/sites/SetupGuide";
import { SiteHome } from "@/features/sites/SiteHome";
import { SiteList } from "@/features/sites/SiteList";
import { ModeSwitch, useRememberLocation } from "@/features/themes/ModeSwitch";
import { ThemeHome, ThemeWelcome } from "@/features/themes/ThemeHome";
import { ThemeList } from "@/features/themes/ThemeList";
import { detectLocale, I18nProvider, useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { desktopBridge } from "@/lib/desktop";
import { useConnection } from "@/lib/events";
import { siteProject, themeProject } from "@/lib/project";
import { setAppearance } from "@/lib/theme";

export function App() {
  const settings = useQuery({ queryKey: keys.settings, queryFn: api.settings, retry: false });
  const locale: Locale = settings.data?.locale ?? detectLocale(navigator.languages);
  const appearance: Appearance | undefined = settings.data?.appearance;
  useSecretsSettled();

  useEffect(() => {
    document.documentElement.lang = locale;
    desktopBridge()?.setLocale?.(locale);
  }, [locale]);
  useEffect(() => {
    if (appearance) setAppearance(appearance);
  }, [appearance]);
  // A file dropped outside the upload area must not make the browser open it (the desktop app's
  // will-navigate blocks the page change, but the drop still needs this).
  useEffect(() => {
    const prevent = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  return (
    <I18nProvider locale={locale}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/" element={<Shell />} />
        <Route path="/sites/:siteId" element={<Shell />} />
        <Route path="/sites/:siteId/sessions/:sessionId" element={<Shell />} />
        <Route path="/themes" element={<Shell />} />
        <Route path="/themes/:themeId" element={<Shell />} />
        <Route path="/themes/:themeId/sessions/:sessionId" element={<Shell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </I18nProvider>
  );
}

function Shell() {
  const { m, errorOf } = useI18n();
  const layout = useDefaultLayout({ id: "bj-main", storage: safeLocalStorage() });
  const { siteId = null, themeId = null, sessionId = null } = useParams();
  const mode = useRememberLocation();
  const narrow = useMediaQuery(NARROW);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useShortcutsKey(useCallback(() => setShortcutsOpen(true), []));
  const site = useQuery({
    queryKey: keys.site(siteId ?? ""),
    queryFn: () => api.site(siteId ?? ""),
    enabled: siteId !== null,
    retry: false,
  });
  const theme = useQuery({
    queryKey: keys.theme(themeId ?? ""),
    queryFn: () => api.themeProject(themeId ?? ""),
    enabled: themeId !== null,
    retry: false,
  });
  const record = themeId !== null ? theme : site;
  const project = site.data ? siteProject(site.data) : theme.data ? themeProject(theme.data) : null;

  // Record the visit so the sidebar lists recently opened projects first (plan 10.1).
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!siteId) return;
    api.openSite(siteId).then(
      () => queryClient.invalidateQueries({ queryKey: keys.sites }),
      () => {},
    );
  }, [siteId, queryClient]);
  useEffect(() => {
    if (!themeId) return;
    api.openTheme(themeId).then(
      () => queryClient.invalidateQueries({ queryKey: keys.themes }),
      () => {},
    );
  }, [themeId, queryClient]);

  const sitesColumn = (
    <div className="flex min-h-0 flex-1 flex-col">
      <ModeSwitch />
      {mode === "theme" ? <ThemeList /> : <SiteList />}
    </div>
  );
  const conversationColumn = (
    <>
      <SectionTitle icon={<MessageSquare className="size-4" />} title={m.conversation.title} />
      <div className={`min-h-0 flex-1 ${sessionId ? "overflow-hidden" : "overflow-auto"}`}>
        {siteId === null && themeId === null ? (
          mode === "theme" ? (
            <ThemeWelcome />
          ) : (
            <Welcome />
          )
        ) : record.isPending ? (
          <p className="p-6 text-sm text-muted-foreground">{m.common.loading}</p>
        ) : record.error ? (
          <p role="alert" className="p-6 text-sm text-destructive">
            {errorOf(record.error)}
          </p>
        ) : sessionId && project ? (
          <ChatView key={sessionId} project={project} sessionId={sessionId} />
        ) : theme.data ? (
          <ThemeHome theme={theme.data} />
        ) : site.data ? (
          <SiteHome site={site.data} />
        ) : null}
      </div>
    </>
  );
  const panelsColumn = (
    <RightPanel key={project?.key ?? mode} mode={mode} project={project?.key ?? null} readOnly={!!project?.readOnly} />
  );

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <TopNotice />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {narrow ? (
        <NarrowLayout
          sites={sitesColumn}
          sitesLabel={mode === "theme" ? m.themes.title : m.sidebar.title}
          conversation={conversationColumn}
          panels={panelsColumn}
        />
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

/** Home page: the first-run guide, what to do first, and notices handed over by navigation (e.g. after removing a site). */
function Welcome() {
  const { m } = useI18n();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  return (
    <div className="flex flex-col gap-4 p-6 text-sm">
      <header className="flex flex-col gap-1" data-testid="slogan">
        <h1 className="text-xl font-semibold tracking-tight">{m.app.slogan}</h1>
        <p className="text-muted-foreground">{m.app.sloganSub}</p>
      </header>
      {notice && (
        <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3" data-testid="notice">
          {notice}
        </p>
      )}
      <SetupGuide />
      <p className="text-muted-foreground" data-testid="conversation-placeholder">
        {m.conversation.placeholder}
      </p>
    </div>
  );
}

/** A thin banner for errors that affect the whole window; hidden when everything is fine. */
function TopNotice() {
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b px-3 py-1 empty:hidden">
      <ConnectionNotice />
      <SessionNotice />
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

/** The session expired or the server is unreachable; the API explains which. */
function SessionNotice() {
  const { errorOf } = useI18n();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });
  if (!health.error) return null;
  return (
    <span role="status" data-testid="health" className="text-xs text-destructive">
      {errorOf(health.error)}
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
  sitesLabel,
  conversation,
  panels,
}: {
  sites: React.ReactNode;
  sitesLabel: string;
  conversation: React.ReactNode;
  panels: React.ReactNode;
}) {
  const { m } = useI18n();
  const { siteId = null, themeId = null, sessionId = null } = useParams();
  const location = useLocation();
  const [column, setColumn] = useState<Column>("conversation");
  useEffect(() => {
    // Runs when the project or conversation changes, not on every render.
    void siteId;
    void themeId;
    void sessionId;
    setColumn("conversation");
  }, [siteId, themeId, sessionId]);
  // Any navigation that names a panel (also "View diff" while that panel is already in the URL).
  useEffect(() => {
    if (new URLSearchParams(location.search).has("panel")) setColumn("panels");
  }, [location.search]);
  const tabs: { id: Column; label: string; icon: React.ReactNode }[] = [
    { id: "sites", label: sitesLabel, icon: <Server className="size-4" /> },
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
