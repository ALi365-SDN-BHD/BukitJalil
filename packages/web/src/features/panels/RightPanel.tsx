import { PanelRight } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { useSearchParams } from "react-router";
import { useI18n } from "@/i18n";
import { dialogOpen, isTypingTarget } from "@/lib/keyboard";
import { PanelLoading } from "./common";
import { PreviewPanel } from "./PreviewPanel";

// The read-only panels (and react-markdown with them) load on first use, keeping them out of the main chunk.
const FilesPanel = lazy(() => import("./FilesPanel").then((x) => ({ default: x.FilesPanel })));
const ConfigPanel = lazy(() => import("./ConfigPanel").then((x) => ({ default: x.ConfigPanel })));
const ThemePanel = lazy(() => import("./ThemePanel").then((x) => ({ default: x.ThemePanel })));
const DataPanel = lazy(() => import("./DataPanel").then((x) => ({ default: x.DataPanel })));
const ChangesPanel = lazy(() => import("@/features/changes/ChangesPanel").then((x) => ({ default: x.ChangesPanel })));

const PANEL_TABS = ["preview", "changes", "files", "config", "theme", "data"] as const;
type PanelTab = (typeof PANEL_TABS)[number];

const isTab = (v: string | null): v is PanelTab => PANEL_TABS.includes(v as PanelTab);

/** The URL with `key` as the open tab; a file or diff selection only belongs to its own tab. */
function withTab(p: URLSearchParams, key: PanelTab): URLSearchParams {
  p.set("panel", key);
  if (key !== "files") p.delete("file");
  if (key !== "changes") p.delete("diff");
  return p;
}

/** Right column (plan 10.2). The open tab lives in the URL (?panel=), so reloads and links keep it. */
export function RightPanel({ siteId, readOnly }: { siteId: string | null; readOnly: boolean }) {
  const { m, t } = useI18n();
  const [params, setParams] = useSearchParams();
  const raw = params.get("panel");
  const tab: PanelTab = isTab(raw) ? raw : "preview";
  const select = (key: PanelTab) => setParams((p) => withTab(p, key), { replace: true });

  // Alt+1…6 picks a tab (plan M5 layer 3). e.code, since Alt+digit types another character on macOS; for
  // the same reason not in text fields, where Option+digit types characters such as [ and ] on some layouts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTypingTarget(e.target) || dialogOpen()) return;
      const n = /^Digit([1-6])$/.exec(e.code)?.[1];
      if (!n) return;
      e.preventDefault();
      setParams((p) => withTab(p, PANEL_TABS[Number(n) - 1] ?? "preview"), { replace: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setParams]);

  let body: React.ReactNode;
  if (!siteId)
    body = (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {t(m.panel.empty, { panel: m.panel[tab] })}
      </div>
    );
  else if (tab === "preview") body = <PreviewPanel siteId={siteId} readOnly={readOnly} />;
  else if (tab === "files") body = <FilesPanel siteId={siteId} />;
  else if (tab === "config") body = <ConfigPanel siteId={siteId} readOnly={readOnly} />;
  else if (tab === "theme") body = <ThemePanel siteId={siteId} />;
  else if (tab === "data") body = <DataPanel siteId={siteId} />;
  else body = <ChangesPanel siteId={siteId} />;

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
            data-testid={`tab-${key}`}
            onClick={() => select(key)}
            title={`Alt+${PANEL_TABS.indexOf(key) + 1}`}
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
