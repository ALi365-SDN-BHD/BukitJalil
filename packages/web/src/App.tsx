import { type Locale, SUPPORTED_LOCALES } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, MessageSquare, PanelRight, Plus, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { detectLocale, I18nProvider, localeNames, useI18n } from "@/i18n";
import { ApiRequestError, api } from "@/lib/api";

const PANEL_TABS = ["preview", "changes", "files", "config", "theme", "data"] as const;
type PanelTab = (typeof PANEL_TABS)[number];

export function App() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings, retry: false });
  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: (data) => queryClient.setQueryData(["settings"], data),
  });
  const locale: Locale = settings.data?.locale ?? detectLocale(navigator.languages);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nProvider locale={locale}>
      <Shell locale={locale} onLocaleChange={(next) => save.mutate({ locale: next })} />
    </I18nProvider>
  );
}

function Shell({ locale, onLocaleChange }: { locale: Locale; onLocaleChange: (l: Locale) => void }) {
  const { m } = useI18n();
  const layout = useDefaultLayout({ id: "bj-main", storage: safeLocalStorage() });

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
        <span className="font-semibold">{m.app.name}</span>
        <HealthBadge />
        <div className="ml-auto flex items-center gap-2 text-sm">
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
        </div>
      </header>

      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
      >
        <Panel id="sites" defaultSize="18" minSize="12" className="flex flex-col border-r">
          <SectionTitle icon={<Server className="size-4" />} title={m.sidebar.title} />
          <div className="flex flex-col gap-2 p-3 text-sm">
            <p className="text-muted-foreground">{m.sidebar.empty}</p>
            <Button size="sm" variant="outline" disabled>
              <Plus /> {m.sidebar.newSite}
            </Button>
            <Button size="sm" variant="ghost" disabled>
              {m.sidebar.importSite}
            </Button>
          </div>
        </Panel>
        <Separator className="w-1 bg-border transition-colors hover:bg-primary/40" />
        <Panel id="conversation" defaultSize="47" minSize="25" className="flex flex-col">
          <SectionTitle icon={<MessageSquare className="size-4" />} title={m.conversation.title} />
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            {m.conversation.placeholder}
          </div>
        </Panel>
        <Separator className="w-1 bg-border transition-colors hover:bg-primary/40" />
        <Panel id="panels" defaultSize="35" minSize="20" className="flex flex-col border-l">
          <RightPanel />
        </Panel>
      </Group>
    </div>
  );
}

function RightPanel() {
  const { m, t } = useI18n();
  const [tab, setTab] = useState<PanelTab>("preview");
  return (
    <>
      <div
        className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5"
        role="tablist"
        aria-label={m.panel.title}
      >
        <PanelRight className="mr-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
        {PANEL_TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-sm ${tab === key ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60"}`}
          >
            {m.panel[key]}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {t(m.panel.empty, { panel: m.panel[tab] })}
      </div>
    </>
  );
}

function HealthBadge() {
  const { m, t, errorText } = useI18n();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });
  let text = m.status.checking;
  let tone = "text-muted-foreground";
  if (health.error) {
    text = health.error instanceof ApiRequestError ? errorText(health.error.code) : m.status.unreachable;
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
