import type { Site } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FolderInput, Lock, Plus } from "lucide-react";
import { useState } from "react";
import { NavLink, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { SessionList } from "@/features/chat/sessions";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { type SiteDialog, SiteDialogs } from "./SiteDialogs";

/** Sidebar (plan 10.1): sites, newest opened first, archived ones folded away. */
export function SiteList() {
  const { m, t, errorOf } = useI18n();
  const sites = useQuery({ queryKey: keys.sites, queryFn: api.sites });
  const [dialog, setDialog] = useState<SiteDialog>(null);
  const [showArchived, setShowArchived] = useState(false);
  const active = sites.data?.filter((s) => !s.archived) ?? [];
  const archived = sites.data?.filter((s) => s.archived) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-1 border-b p-2">
        <Button size="sm" variant="outline" data-testid="new-site" onClick={() => setDialog("new")}>
          <Plus /> {m.sidebar.newSite}
        </Button>
        <Button size="sm" variant="ghost" data-testid="import-site" onClick={() => setDialog("import")}>
          <FolderInput /> {m.sidebar.importSite}
        </Button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2 text-sm" aria-label={m.sidebar.title} data-testid="site-list">
        {sites.isPending && <p className="p-2 text-muted-foreground">{m.common.loading}</p>}
        {sites.error && (
          <p className="p-2 text-destructive" role="alert">
            {errorOf(sites.error)}
          </p>
        )}
        {sites.data?.length === 0 && <p className="p-2 text-muted-foreground">{m.sidebar.empty}</p>}
        <ul className="flex flex-col gap-0.5">
          {active.map((s) => (
            <SiteItem key={s.id} site={s} />
          ))}
        </ul>
        {archived.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={showArchived}
              onClick={() => setShowArchived(!showArchived)}
            >
              {showArchived ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              {t(m.sidebar.archived, { count: archived.length })}
            </button>
            {showArchived && (
              <ul className="flex flex-col gap-0.5 opacity-75">
                {archived.map((s) => (
                  <SiteItem key={s.id} site={s} />
                ))}
              </ul>
            )}
          </div>
        )}
      </nav>
      <SiteDialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

function SiteItem({ site }: { site: Site }) {
  const { m } = useI18n();
  const { siteId } = useParams();
  return (
    <li>
      <NavLink
        to={`/sites/${site.id}`}
        className={({ isActive }) =>
          `flex items-center gap-2 rounded-md px-2 py-1.5 ${isActive && siteId === site.id ? "bg-accent font-medium" : "hover:bg-accent/60"}`
        }
        title={site.path}
      >
        <span className="min-w-0 flex-1 truncate">{site.name}</span>
        {site.readOnly && (
          <Lock className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-label={m.sidebar.readOnly} />
        )}
      </NavLink>
      {siteId === site.id && <SessionList siteId={site.id} readOnly={!!site.readOnly} />}
    </li>
  );
}
