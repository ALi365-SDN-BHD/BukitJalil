import { PanelRight } from "lucide-react";
import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router";
import { useI18n } from "@/i18n";
import { PanelLoading } from "./common";
import { PreviewPanel } from "./PreviewPanel";

// The read-only panels (and react-markdown with them) load on first use, keeping them out of the main chunk.
const FilesPanel = lazy(() => import("./FilesPanel").then((x) => ({ default: x.FilesPanel })));
const ConfigPanel = lazy(() => import("./ConfigPanel").then((x) => ({ default: x.ConfigPanel })));
const ThemePanel = lazy(() => import("./ThemePanel").then((x) => ({ default: x.ThemePanel })));
const DataPanel = lazy(() => import("./DataPanel").then((x) => ({ default: x.DataPanel })));

const PANEL_TABS = ["preview", "changes", "files", "config", "theme", "data"] as const;
type PanelTab = (typeof PANEL_TABS)[number];

const isTab = (v: string | null): v is PanelTab => PANEL_TABS.includes(v as PanelTab);

/** Right column (plan 10.2). The open tab lives in the URL (?panel=), so reloads and links keep it. */
export function RightPanel({ siteId, readOnly }: { siteId: string | null; readOnly: boolean }) {
  const { m, t } = useI18n();
  const [params, setParams] = useSearchParams();
  const raw = params.get("panel");
  const tab: PanelTab = isTab(raw) ? raw : "preview";
  const select = (key: PanelTab) =>
    setParams(
      (p) => {
        p.set("panel", key);
        if (key !== "files") p.delete("file");
        return p;
      },
      { replace: true },
    );

  let body: React.ReactNode;
  if (!siteId)
    body = (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {t(m.panel.empty, { panel: m.panel[tab] })}
      </div>
    );
  else if (tab === "preview") body = <PreviewPanel siteId={siteId} readOnly={readOnly} />;
  else if (tab === "files") body = <FilesPanel siteId={siteId} />;
  else if (tab === "config") body = <ConfigPanel siteId={siteId} />;
  else if (tab === "theme") body = <ThemePanel siteId={siteId} />;
  else if (tab === "data") body = <DataPanel siteId={siteId} />;
  else
    body = (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">{m.changes.later}</div>
    );

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
