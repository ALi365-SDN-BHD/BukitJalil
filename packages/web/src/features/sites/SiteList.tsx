import type { Site } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  FolderInput,
  Lock,
  MoreHorizontal,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SessionList } from "@/features/chat/sessions";
import { useOpenSettings } from "@/features/settings/useOpenSettings";
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
      <SidebarFooter />
      <SiteDialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

/** Version and the way into the settings page, pinned to the bottom of the sites column. */
function SidebarFooter() {
  const { m } = useI18n();
  const openSettings = useOpenSettings();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });
  const version = health.data?.version;
  return (
    <div className="flex shrink-0 items-center gap-2 border-t px-2 py-1.5">
      <Link
        to="/"
        className="min-w-0 flex-1 truncate text-xs text-muted-foreground hover:text-foreground"
        data-testid="app-version"
      >
        {m.app.name}
        {version && version !== "0.0.0" ? ` v${version}` : ""}
      </Link>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 gap-1 px-1.5 text-xs"
        aria-label={m.settings.open}
        title={m.settings.open}
        data-testid="open-settings"
        onClick={() => openSettings()}
      >
        <Settings className="size-4" />
        {m.settings.open}
      </Button>
    </div>
  );
}

function SiteItem({ site }: { site: Site }) {
  const { m } = useI18n();
  const { siteId } = useParams();
  const selected = siteId === site.id;
  return (
    <li className="flex flex-col" data-testid={`site-item-${site.id}`}>
      <div
        className={`group flex flex-wrap items-center rounded-md ${selected ? "bg-foreground/10" : "hover:bg-accent/60"}`}
      >
        <NavLink
          to={`/sites/${site.id}`}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-base ${selected ? "font-medium" : ""}`}
          title={site.path}
        >
          <span className="min-w-0 flex-1 truncate">{site.name}</span>
          {site.readOnly && (
            <Lock className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-label={m.sidebar.readOnly} />
          )}
        </NavLink>
        <SiteMenu site={site} />
      </div>
      {selected && <SessionList siteId={site.id} readOnly={!!site.readOnly} />}
    </li>
  );
}

/** Archive/unarchive and remove live in the site row, like a desktop sidebar's item menu. */
function SiteMenu({ site }: { site: Site }) {
  const { m, t, errorOf } = useI18n();
  const { siteId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const archive = useMutation({
    mutationFn: () => api.patchSite(site.id, { archived: !site.archived }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.sites });
      void queryClient.invalidateQueries({ queryKey: keys.site(site.id) });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.removeSite(site.id),
    onSuccess: ({ leftovers }) => {
      setConfirmRemove(false);
      queryClient.removeQueries({ queryKey: keys.site(site.id) });
      void queryClient.invalidateQueries({ queryKey: keys.sites });
      if (siteId === site.id) {
        navigate(
          "/",
          leftovers.length > 0 ? { state: { notice: t(m.site.leftovers, { items: leftovers.join(", ") }) } } : {},
        );
      }
    },
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="mr-0.5 shrink-0 text-muted-foreground"
            aria-label={m.site.more}
            title={m.site.more}
            data-testid={`site-menu-${site.id}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={archive.isPending} onSelect={() => archive.mutate()} data-testid="site-archive">
            {site.archived ? <ArchiveRestore /> : <Archive />}
            {site.archived ? m.site.unarchive : m.site.archive}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setConfirmRemove(true)}
            data-testid="site-remove"
          >
            <Trash2 /> {m.site.remove}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {archive.error && (
        <p role="alert" className="w-full px-2 pb-1 text-xs text-destructive">
          {errorOf(archive.error)}
        </p>
      )}
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent closeLabel={m.common.close}>
          <DialogTitle>{t(m.site.removeTitle, { name: site.name })}</DialogTitle>
          <DialogDescription>{t(m.site.removeBody, { path: site.path })}</DialogDescription>
          {remove.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorOf(remove.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              {m.common.cancel}
            </Button>
            <Button
              variant="destructive"
              data-testid="site-remove-confirm"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {m.site.removeConfirm}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
