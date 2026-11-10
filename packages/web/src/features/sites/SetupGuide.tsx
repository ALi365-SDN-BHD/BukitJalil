import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { type SiteDialog, SiteDialogs } from "./SiteDialogs";

type StepState = "done" | "todo" | "blocked" | "checking";

/**
 * First-run guide on the home page (plan M5 layer 1): git, Bukit, the commit identity, a model and the
 * first site, in that order, each with its state and the place to fix it. Gone once all are done.
 */
export function SetupGuide({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { m } = useI18n();
  const [dialog, setDialog] = useState<SiteDialog>(null);
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });
  const bukit = useQuery({ queryKey: keys.bukit, queryFn: api.bukit });
  const settings = useQuery({ queryKey: keys.settings, queryFn: api.settings, retry: false });
  const models = useQuery({ queryKey: keys.models, queryFn: api.models });
  const sites = useQuery({ queryKey: keys.sites, queryFn: api.sites });

  const state = (ready: boolean | undefined, failed = false): StepState =>
    ready === undefined ? (failed ? "blocked" : "checking") : ready ? "done" : "todo";
  const selected = models.data?.selected;
  const provider = models.data?.providers.find((p) => p.id === selected?.provider);
  const steps: { id: string; title: string; hint: string; state: StepState; action?: React.ReactNode }[] = [
    {
      id: "git",
      title: m.setup.git,
      hint: m.setup.gitHint,
      state: health.data ? (health.data.git.ok ? "done" : "blocked") : state(undefined, !!health.error),
    },
    {
      id: "bukit",
      title: m.setup.bukit,
      hint: m.setup.bukitHint,
      state: state(bukit.data ? bukit.data.status.state === "ok" : undefined, !!bukit.error),
      action: (
        <Button size="xs" variant="outline" onClick={onOpenSettings}>
          {m.setup.openSettings}
        </Button>
      ),
    },
    {
      id: "identity",
      title: m.setup.identity,
      hint: m.setup.identityHint,
      state: state(
        settings.data ? !!settings.data.commitName && !!settings.data.commitEmail : undefined,
        !!settings.error,
      ),
      action: (
        <Button size="xs" variant="outline" onClick={onOpenSettings}>
          {m.setup.openSettings}
        </Button>
      ),
    },
    {
      id: "model",
      title: m.setup.model,
      hint: m.setup.modelHint,
      state: state(
        models.data ? !!selected && !models.data.selectedMissing && !!provider?.key.configured : undefined,
        !!models.error,
      ),
      action: (
        <Button size="xs" variant="outline" onClick={onOpenSettings}>
          {m.setup.openSettings}
        </Button>
      ),
    },
    {
      id: "site",
      title: m.setup.site,
      hint: m.setup.siteHint,
      state: state(sites.data ? sites.data.length > 0 : undefined, !!sites.error),
      action: (
        <span className="flex gap-1">
          <Button size="xs" onClick={() => setDialog("new")} data-testid="setup-new-site">
            {m.sidebar.newSite}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setDialog("import")}>
            {m.sidebar.importSite}
          </Button>
        </span>
      ),
    },
  ];
  if (steps.every((s) => s.state === "done")) return null;
  // Shown once every check has answered, so steps do not flip while it loads.
  if (steps.some((s) => s.state === "checking")) return null;
  const next = steps.find((s) => s.state !== "done")?.id;

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4" data-testid="setup-guide">
      <div>
        <h2 className="text-base font-semibold">{m.setup.title}</h2>
        <p className="text-muted-foreground">{m.setup.intro}</p>
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2" data-testid={`setup-${s.id}`} data-state={s.state}>
            <StepIcon state={s.state} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={s.state === "done" ? "text-muted-foreground line-through" : "font-medium"}>
                {s.title}
              </span>
              {s.state !== "done" && s.id === next && (
                <>
                  <span className="text-xs text-muted-foreground">{s.hint}</span>
                  {s.action && <div className="flex">{s.action}</div>}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      <SiteDialogs dialog={dialog} onClose={() => setDialog(null)} />
    </section>
  );
}

function StepIcon({ state }: { state: StepState }) {
  const { m } = useI18n();
  if (state === "done")
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label={m.setup.done} />;
  if (state === "blocked")
    return <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label={m.setup.blocked} />;
  return <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label={m.setup.todo} />;
}
