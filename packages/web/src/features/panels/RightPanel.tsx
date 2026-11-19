import type { ProjectKey } from "@bukitjalil/shared";
import { PanelRight } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { useSearchParams } from "react-router";
import { useI18n } from "@/i18n";
import { dialogOpen, isTypingTarget } from "@/lib/keyboard";
import type { Mode } from "@/lib/project";
import { PanelLoading } from "./common";
import { PreviewPanel } from "./PreviewPanel";

// The read-only panels (and react-markdown with them) load on first use, keeping them out of the main chunk.
const FilesPanel = lazy(() => import("./FilesPanel").then((x) => ({ default: x.FilesPanel })));
const ConfigPanel = lazy(() => import("./ConfigPanel").then((x) => ({ default: x.ConfigPanel })));
const ThemePanel = lazy(() => import("./ThemePanel").then((x) => ({ default: x.ThemePanel })));
const DataPanel = lazy(() => import("./DataPanel").then((x) => ({ default: x.DataPanel })));
const SeoPanel = lazy(() => import("./SeoPanel").then((x) => ({ default: x.SeoPanel })));
const SamplesPanel = lazy(() => import("./SamplesPanel").then((x) => ({ default: x.SamplesPanel })));
const ReferencePanel = lazy(() => import("./ReferencePanel").then((x) => ({ default: x.ReferencePanel })));
const ChangesPanel = lazy(() => import("@/features/changes/ChangesPanel").then((x) => ({ default: x.ChangesPanel })));

const SITE_TABS = ["preview", "changes", "files", "config", "theme", "data", "seo"] as const;
/** Theme development's panels (design 2): the theme is the main one, sample content and reference images added. */
const THEME_TABS = ["preview", "changes", "files", "theme", "samples", "reference"] as const;
type PanelTab = (typeof SITE_TABS)[number] | (typeof THEME_TABS)[number];
const TABS: Record<Mode, readonly PanelTab[]> = { site: SITE_TABS, theme: THEME_TABS };

/** The URL with `key` as the open tab; a file or diff selection only belongs to its own tab. */
function withTab(p: URLSearchParams, key: PanelTab): URLSearchParams {
  p.set("panel", key);
  if (key !== "files") p.delete("file");
  if (key !== "changes") p.delete("diff");
  return p;
}

/** Right column (plan 10.2). The open tab lives in the URL (?panel=), so reloads and links keep it. */
export function RightPanel({ mode, project, readOnly }: { mode: Mode; project: ProjectKey | null; readOnly: boolean }) {
  const { m, t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tabs = TABS[mode];
  const raw = params.get("panel");
  const tab: PanelTab = tabs.find((x) => x === raw) ?? "preview";
  const select = (key: PanelTab) => setParams((p) => withTab(p, key), { replace: true });

  // Alt+1…7 picks a tab (plan M5 layer 3). e.code, since Alt+digit types another character on macOS; for
  // the same reason not in text fields, where Option+digit types characters such as [ and ] on some layouts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTypingTarget(e.target) || dialogOpen()) return;
      const key = tabs[Number(/^Digit([1-9])$/.exec(e.code)?.[1] ?? 0) - 1];
      if (!key) return;
      e.preventDefault();
      setParams((p) => withTab(p, key), { replace: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setParams, tabs]);

  let body: React.ReactNode;
  if (!project)
    body = (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {t(mode === "theme" ? m.panel.emptyTheme : m.panel.empty, { panel: m.panel[tab] })}
      </div>
    );
  else if (tab === "preview") body = <PreviewPanel project={project} readOnly={readOnly} />;
  else if (tab === "files") body = <FilesPanel project={project} />;
  else if (tab === "config") body = <ConfigPanel project={project} readOnly={readOnly} />;
  else if (tab === "theme") body = <ThemePanel project={project} />;
  else if (tab === "data") body = <DataPanel project={project} />;
  else if (tab === "seo") body = <SeoPanel siteId={project} readOnly={readOnly} />;
  else if (tab === "samples") body = <SamplesPanel project={project} />;
  else if (tab === "reference") body = <ReferencePanel project={project} />;
  else body = <ChangesPanel project={project} readOnly={readOnly} />;

  return (
    <>
      <div
        className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5"
        role="tablist"
        aria-label={m.panel.title}
      >
        <PanelRight className="mr-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-testid={`tab-${key}`}
            onClick={() => select(key)}
            // The shortcut is announced as such; the title keeps the label first, so no tool reads the tab as "Alt+N".
            aria-keyshortcuts={`Alt+${tabs.indexOf(key) + 1}`}
            title={`${m.panel[key]} (Alt+${tabs.indexOf(key) + 1})`}
            className={`shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-sm ${tab === key ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60"}`}
          >
            {m.panel[key]}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
        <Suspense fallback={<PanelLoading />}>{body}</Suspense>
      </div>
    </>
  );
}
