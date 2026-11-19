import type { Theme } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Globe,
  Lock,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
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
import { SidebarFooter } from "@/features/sites/SiteList";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { desktopBridge } from "@/lib/desktop";
import { themeKey } from "@/lib/project";
import { CloneSiteDialog } from "./CloneSiteDialog";
import { ImportThemeDialog } from "./ImportThemeDialog";
import { NewThemeDialog, useOpenCreatedTheme } from "./NewThemeDialog";

/** Theme development's sidebar (design 2): theme projects, newest opened first, archived ones folded away. */
export function ThemeList() {
  const { m, t, errorOf } = useI18n();
  const openCreated = useOpenCreatedTheme();
  const themes = useQuery({ queryKey: keys.themes, queryFn: api.themes });
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const active = themes.data?.filter((x) => !x.archived) ?? [];
  const archived = themes.data?.filter((x) => x.archived) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-1 border-b p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" data-testid="new-theme">
              <Plus /> {m.themes.newTheme} <ChevronDown className="ml-auto" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setCreating(true)} data-testid="new-theme-description">
              <Plus /> {m.themes.fromDescription}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setImporting(true)} data-testid="import-theme">
              <Upload /> {m.themes.importTheme}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!desktopBridge()} onSelect={() => setCloning(true)} data-testid="clone-site">
              <Globe /> {desktopBridge() ? m.themes.cloneSite : m.themes.cloneNeedsDesktop}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2 text-sm" aria-label={m.themes.title} data-testid="theme-list">
        {themes.isPending && <p className="p-2 text-muted-foreground">{m.common.loading}</p>}
        {themes.error && (
          <p className="p-2 text-destructive" role="alert">
            {errorOf(themes.error)}
          </p>
        )}
        {themes.data?.length === 0 && <p className="p-2 text-muted-foreground">{m.themes.empty}</p>}
        <ul className="flex flex-col gap-0.5">
          {active.map((x) => (
            <ThemeItem key={x.id} theme={x} />
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
                {archived.map((x) => (
                  <ThemeItem key={x.id} theme={x} />
                ))}
              </ul>
            )}
          </div>
        )}
      </nav>
      <SidebarFooter />
      {/* Mounted only while open, so each opening starts empty. */}
      {creating && <NewThemeDialog onClose={() => setCreating(false)} onCreated={openCreated} />}
      {importing && <ImportThemeDialog onClose={() => setImporting(false)} onCreated={openCreated} />}
      {cloning && <CloneSiteDialog onClose={() => setCloning(false)} onCreated={() => {}} />}
    </div>
  );
}

function ThemeItem({ theme }: { theme: Theme }) {
  const { m } = useI18n();
  const { themeId } = useParams();
  const selected = themeId === theme.id;
  return (
    <li className="flex flex-col" data-testid={`theme-item-${theme.id}`}>
      <div
        className={`group flex flex-wrap items-center rounded-md ${selected ? "bg-foreground/10" : "hover:bg-accent/60"}`}
      >
        <NavLink
          to={`/themes/${theme.id}`}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-base ${selected ? "font-medium" : ""}`}
          title={theme.path}
        >
          <span className="min-w-0 flex-1 truncate">{theme.name}</span>
          {theme.readOnly && (
            <Lock className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-label={m.sidebar.readOnly} />
          )}
        </NavLink>
        <ThemeMenu theme={theme} />
      </div>
      {selected && <SessionList project={themeKey(theme.id)} readOnly={!!theme.readOnly} />}
    </li>
  );
}

/** Archive/unarchive and remove, in the theme project's row. */
function ThemeMenu({ theme }: { theme: Theme }) {
  const { m, t, errorOf } = useI18n();
  const { themeId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const archive = useMutation({
    mutationFn: () => api.patchTheme(theme.id, { archived: !theme.archived }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.themes });
      void queryClient.invalidateQueries({ queryKey: keys.theme(theme.id) });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.removeTheme(theme.id),
    onSuccess: ({ leftovers }) => {
      setConfirmRemove(false);
      queryClient.removeQueries({ queryKey: keys.theme(theme.id) });
      void queryClient.invalidateQueries({ queryKey: keys.themes });
      if (themeId === theme.id) {
        navigate(
          "/themes",
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
            data-testid={`theme-menu-${theme.id}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={archive.isPending} onSelect={() => archive.mutate()} data-testid="theme-archive">
            {theme.archived ? <ArchiveRestore /> : <Archive />}
            {theme.archived ? m.site.unarchive : m.site.archive}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setConfirmRemove(true)}
            data-testid="theme-remove"
          >
            <Trash2 /> {m.themes.remove}
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
          <DialogTitle>{t(m.site.removeTitle, { name: theme.name })}</DialogTitle>
          <DialogDescription>{t(m.themes.removeBody, { path: theme.path })}</DialogDescription>
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
              data-testid="theme-remove-confirm"
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
