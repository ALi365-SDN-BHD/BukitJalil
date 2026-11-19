import type { Theme, ThemeApplyResult } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";

/**
 * Apply the theme project's default branch to a site (theme development design 7): the confirmation shows
 * what the site's default branch has, which files change, and whether the site's theme.name is switched.
 * Applying makes a user-authored change set on the site; reviewing and applying it stays on the site.
 */
export function ApplyThemeDialog({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { m, t, errorOf } = useI18n();
  const n = m.themes.apply;
  const queryClient = useQueryClient();
  const sites = useQuery({ queryKey: keys.sites, queryFn: api.sites });
  const usable = sites.data?.filter((s) => !s.archived) ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const siteId = selected ?? usable.find((s) => !s.readOnly)?.id ?? null;
  const plan = useQuery({
    queryKey: ["theme-apply", theme.id, siteId ?? ""],
    queryFn: () => api.themeApplyPlan(theme.id, siteId ?? ""),
    enabled: siteId !== null,
  });
  const [setConfig, setSetConfig] = useState(true);
  const [result, setResult] = useState<ThemeApplyResult | null>(null);
  const defaultConfig = plan.data ? plan.data.configTheme !== theme.themeName : false;
  // The switch starts at "switch the site's theme" unless the site already names this theme.
  useEffect(() => setSetConfig(defaultConfig), [defaultConfig]);
  const apply = useMutation({
    mutationFn: () => api.applyTheme(theme.id, { siteId: siteId ?? "", overwrite: plan.data?.existing, setConfig }),
    onSuccess: (applied) => {
      setResult(applied);
      if (applied.siteId) void queryClient.invalidateQueries({ queryKey: keys.change(applied.siteId) });
    },
  });
  const nothing = apply.data?.changeId === null;
  const done = result !== null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={m.common.close} className="max-w-xl" data-testid="apply-theme-dialog">
        <DialogTitle className="flex items-center gap-2">
          <Palette className="size-4" /> {done ? n.done : n.title}
        </DialogTitle>
        {done ? (
          <div className="flex flex-col gap-3 text-sm">
            <DialogDescription>{nothing ? n.noChanges : n.doneBody}</DialogDescription>
            {!nothing && result.siteId && (
              <Link className="text-primary underline" to={`/sites/${result.siteId}?panel=changes`}>
                {n.review}
              </Link>
            )}
            <div className="flex justify-end">
              <Button onClick={onClose}>{m.common.close}</Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              apply.mutate();
            }}
          >
            <DialogDescription>{t(n.description, { dir: theme.themeName })}</DialogDescription>
            <Field label={n.site} htmlFor="apply-theme-site">
              <select
                id="apply-theme-site"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={siteId ?? ""}
                data-testid="apply-theme-site"
                onChange={(e) => setSelected(e.target.value)}
              >
                {usable.length === 0 && <option value="">{n.noSites}</option>}
                {usable.map((site) => (
                  <option key={site.id} value={site.id} disabled={site.readOnly !== null}>
                    {site.name}
                  </option>
                ))}
              </select>
            </Field>
            {plan.isPending && siteId && <p className="text-xs text-muted-foreground">{n.check}</p>}
            {plan.error && (
              <p role="alert" className="text-sm text-destructive">
                {errorOf(plan.error)}
              </p>
            )}
            {plan.data && (
              <>
                {plan.data.existing && (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
                    {t(n.existing, { dir: theme.themeName })}
                  </p>
                )}
                {!plan.data.existing &&
                  plan.data.added.length === 0 &&
                  plan.data.modified.length === 0 &&
                  plan.data.removed.length === 0 && <p className="text-xs">{n.same}</p>}
                <Diff label={n.added} paths={plan.data.added} />
                <Diff label={n.modified} paths={plan.data.modified} />
                <Diff label={n.removed} paths={plan.data.removed} />
                <div className="flex items-start gap-3 rounded-md border p-2">
                  <Switch
                    checked={setConfig}
                    onCheckedChange={setSetConfig}
                    label={t(n.setConfig, { name: theme.themeName })}
                    testId="apply-theme-set-config"
                  />
                  <div className="text-xs">
                    <p>{t(n.setConfig, { name: theme.themeName })}</p>
                    <p className="text-muted-foreground">
                      {plan.data.configTheme === null
                        ? n.setConfigNone
                        : t(n.setConfigHint, { current: plan.data.configTheme })}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{n.rootLayouts}</p>
              </>
            )}
            {apply.error && (
              <p role="alert" className="text-sm text-destructive">
                {errorOf(apply.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {m.common.cancel}
              </Button>
              <Button
                type="submit"
                data-testid="apply-theme-confirm"
                disabled={apply.isPending || !siteId || !plan.data}
              >
                {apply.isPending ? n.applying : n.apply}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One group of changed paths, folded away until asked for. */
function Diff({ label, paths }: { label: string; paths: string[] }) {
  const { t } = useI18n();
  if (paths.length === 0) return null;
  return (
    <details className="rounded-md border p-2 text-xs">
      <summary className="cursor-pointer">{t(label, { count: paths.length })}</summary>
      <ul className="mt-1 max-h-40 overflow-auto font-mono">
        {paths.map((p) => (
          <li key={p} className="truncate" title={p}>
            {p}
          </li>
        ))}
      </ul>
    </details>
  );
}
