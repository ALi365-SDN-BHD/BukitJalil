import type { Site } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PatchView } from "@/features/changes/FileDiffView";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";

/**
 * The Bukit 2.1 language migration (plan 8.7): when the default branch's site.yaml still has site.language,
 * or a multilingual site would move its default language to the root, show the change to site.yaml and
 * commit it when the user applies it. Nothing is changed until then.
 */
export function LanguageMigrationCard({ site }: { site: Site }) {
  const { m, errorOf } = useI18n();
  const l = m.languageMigration;
  const queryClient = useQueryClient();
  const plan = useQuery({
    queryKey: keys.languageMigration(site.id),
    queryFn: () => api.languageMigration(site.id),
    enabled: site.readOnly === null,
  });
  const apply = useMutation({
    mutationFn: (commit: string) => api.applyLanguageMigration(site.id, commit),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.languageMigration(site.id), data);
      void queryClient.invalidateQueries({ queryKey: ["panel", site.id] });
      void queryClient.invalidateQueries({ queryKey: keys.site(site.id) });
      void queryClient.invalidateQueries({ queryKey: keys.history(site.id) });
      void queryClient.invalidateQueries({ queryKey: keys.builds(site.id) });
      void queryClient.invalidateQueries({ queryKey: keys.deploy(site.id) });
    },
    // The head moved or the file changed: show what is there now.
    onError: () => void queryClient.invalidateQueries({ queryKey: keys.languageMigration(site.id) }),
  });

  const data = plan.data;
  if (site.readOnly !== null) return null;
  if (plan.error) {
    return (
      <p role="alert" className="text-xs text-destructive" data-testid="language-migration-error">
        {errorOf(plan.error)}
      </p>
    );
  }
  if (!data || data.state === "none") return null;
  // An error about an older patch is stale once a newer one is shown.
  const applyError = apply.error && apply.variables === data.commit ? apply.error : null;
  return (
    <section
      className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
      data-testid="language-migration"
    >
      <h2 className="flex items-center gap-1.5 font-medium">
        <Languages className="size-4 text-muted-foreground" aria-hidden /> {l.title}
      </h2>
      <p className="text-xs text-muted-foreground">{l.why}</p>
      {data.state === "blocked" ? (
        <p className="text-xs" data-testid="language-migration-blocked">
          {data.reason === "default_not_listed"
            ? l.defaultNotListed
            : data.reason === "bad_languages"
              ? l.badLanguages
              : l.badLanguage}
        </p>
      ) : (
        <>
          <p className="text-xs">{l.what}</p>
          {data.movesToRoot && (
            <p className="text-xs font-medium" data-testid="language-migration-moves">
              {l.movesToRoot}
            </p>
          )}
          <div className="flex max-h-60 flex-col overflow-hidden rounded border bg-background">
            <PatchView path="site.yaml" patch={data.patch ?? ""} />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              data-testid="language-migration-apply"
              disabled={apply.isPending}
              onClick={() => apply.mutate(data.commit)}
            >
              {l.apply}
            </Button>
            <span className="text-xs text-muted-foreground">{l.applyHint}</span>
          </div>
        </>
      )}
      {applyError && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(applyError)}
        </p>
      )}
    </section>
  );
}
