import {
  BUKIT_BUILTIN_PLUGINS,
  BUKIT_PLUGIN_CONFIG,
  type BukitPluginId,
  type BukitPluginState,
  type ConfigSummary,
  type PanelRef,
} from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useCurrentChange, usePanelRef } from "@/features/changes/hooks";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { CodeView } from "./CodeView";
import { Facts, PanelError, PanelLoading, RefSwitch, Section, Table } from "./common";

/** Config panel (plan 5.3): a summary of site.yaml, its source, and the per-site plugin switches. */
export function ConfigPanel({ siteId, readOnly }: { siteId: string; readOnly: boolean }) {
  const [ref, setRef] = usePanelRef(siteId);
  const { m, t } = useI18n();
  const config = useQuery({
    queryKey: keys.panel(siteId, "config", ref),
    queryFn: () => api.config(siteId, ref),
  });
  const current = useCurrentChange(siteId);
  const [, setParams] = useSearchParams();
  const [view, setView] = useState<"summary" | "plugins" | "raw">("summary");

  const viewChange = () =>
    setParams(
      (p) => {
        p.set("panel", "changes");
        p.set("diff", "site.yaml");
        return p;
      },
      { replace: true },
    );

  let body: React.ReactNode;
  if (config.isPending) body = <PanelLoading />;
  else if (config.error) body = <PanelError error={config.error} />;
  else if (config.data.raw === null) body = <p className="p-6 text-sm text-muted-foreground">{m.config.noSiteYaml}</p>;
  else if (view === "raw") body = <CodeView code={config.data.raw} lang="yaml" />;
  else if (config.data.error !== null || !config.data.summary)
    body = (
      <p role="alert" className="p-6 text-sm text-destructive">
        {t(m.config.parseError, { error: config.data.error ?? "" })}
      </p>
    );
  else if (view === "plugins")
    body = (
      <PluginsEditor
        siteId={siteId}
        states={config.data.summary.pluginStates}
        readOnly={readOnly}
        ref={ref}
        setRef={setRef}
        hasChange={current.change !== null}
        hasPluginChange={current.change?.files.some((f) => f.path === "site.yaml") ?? false}
        onViewChange={viewChange}
      />
    );
  else body = <Summary summary={config.data.summary} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RefSwitch siteId={siteId} />
      <div className="flex shrink-0 gap-1 border-b px-2 py-1 text-xs" role="tablist">
        {(["summary", "plugins", "raw"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            data-testid={`config-tab-${v}`}
            className={`rounded px-2 py-0.5 ${view === v ? "bg-accent font-medium" : "text-muted-foreground"}`}
            onClick={() => setView(v)}
          >
            {m.config[v]}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto" data-testid="config-panel">
        {body}
      </div>
    </div>
  );
}

function PluginsEditor({
  siteId,
  states,
  readOnly,
  ref,
  setRef,
  hasChange,
  hasPluginChange,
  onViewChange,
}: {
  siteId: string;
  states: BukitPluginState[] | null;
  readOnly: boolean;
  ref: PanelRef;
  setRef: (ref: PanelRef) => void;
  hasChange: boolean;
  hasPluginChange: boolean;
  onViewChange: () => void;
}) {
  const { m, errorOf } = useI18n();
  const p = m.bukitPlugins;
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({
    mutationFn: (vars: { id: BukitPluginId; enabled: boolean }) => api.setSitePlugin(siteId, vars.id, vars.enabled),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.change(siteId), data);
      if (data.change) setRef("change");
      void queryClient.invalidateQueries({ queryKey: ["panel", siteId, "config"] });
      setError(null);
    },
    onError: setError,
  });
  const switching = hasChange && ref === "main";

  // The switch writes to the open change set, so show that version, not main's stale state.
  useEffect(() => {
    if (switching) setRef("change");
  }, [switching, setRef]);

  if (states === null)
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {p.invalid}
      </p>
    );

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="config-plugins">
      <p className="text-sm font-medium">{p.configTitle}</p>
      <p className="text-xs text-muted-foreground">{p.configDescription}</p>
      <p className="text-xs text-muted-foreground">{p.applyNote}</p>
      {readOnly && <p className="text-xs text-amber-700 dark:text-amber-400">{p.readOnly}</p>}
      {hasPluginChange && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
          <span className="min-w-0 flex-1">{p.pending}</span>
          <Button type="button" size="xs" variant="outline" onClick={onViewChange} data-testid="config-view-change">
            {p.viewChange}
          </Button>
        </div>
      )}
      {!hasPluginChange && hasChange && <p className="text-xs text-muted-foreground">{p.pendingHint}</p>}
      {error !== null && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(error)}
        </p>
      )}
      <div className="divide-y">
        {states.map((state) => {
          const meta = BUKIT_BUILTIN_PLUGINS.find((plugin) => plugin.id === state.id);
          if (!meta) return null;
          const item = p.items[state.id];
          const stages = meta.stages.map((stage) => p.stages[stage]).join(" · ");
          return (
            <div key={state.id} className="flex items-start justify-between gap-4 py-4">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {item.name}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">
                    {state.id}
                  </code>
                </div>
                <p className="text-xs text-muted-foreground">{item.description}</p>
                <p className="text-[11px] text-muted-foreground">
                  {stages} · {BUKIT_PLUGIN_CONFIG[state.id].join(" · ")}
                </p>
                <p className="text-[11px] text-muted-foreground">{state.configured ? p.setInYaml : p.defaultState}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Switch
                  checked={state.enabled}
                  disabled={readOnly || switching || save.isPending}
                  onCheckedChange={(enabled) => save.mutate({ id: state.id, enabled })}
                  label={item.name}
                  testId={`plugin-toggle-${state.id}`}
                />
                <span className="text-xs text-muted-foreground">{state.enabled ? p.on : p.off}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Summary({ summary: s }: { summary: ConfigSummary }) {
  const { m } = useI18n();
  const c = m.config;
  const yesNo = (v: boolean | null) => (v === null ? null : v ? m.common.yes : m.common.no);
  return (
    <div className="flex flex-col gap-5 p-4">
      <Section title={c.site}>
        <Facts
          rows={[
            [c.name, s.site.name],
            [c.title, s.site.title],
            [c.description, s.site.description],
            [c.url, s.site.url],
            [c.baseUrl, s.site.baseUrl],
            [c.language, s.site.language],
            [c.languages, s.site.languages.join(", ")],
            [c.timezone, s.site.timezone],
          ]}
        />
      </Section>
      <Section title={c.collections}>
        {s.collections.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.common.none}</p>
        ) : (
          <Table
            head={[c.name, c.permalink, c.listRoute]}
            rows={s.collections.map((x) => [x.name, x.permalink, x.listRoute])}
          />
        )}
      </Section>
      <Section title={c.sources}>
        {s.sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.common.none}</p>
        ) : (
          <Table
            head={[c.name, c.type, c.mode, c.collection]}
            rows={s.sources.map((x) => [x.name, x.type, x.mode, x.collection])}
          />
        )}
      </Section>
      <Section title={c.build}>
        <Facts
          rows={[
            [c.output, s.build.output],
            [c.draft, yesNo(s.build.draft)],
            [c.clean, yesNo(s.build.clean)],
            [c.theme, s.theme.name],
            [c.otherSections, s.otherSections.join(", ")],
          ]}
        />
      </Section>
    </div>
  );
}
