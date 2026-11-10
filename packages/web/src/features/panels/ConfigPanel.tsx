import type { ConfigSummary } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { CodeView } from "./CodeView";
import { Facts, PanelError, PanelLoading, RefSwitch, Section, Table } from "./common";

/** Config panel (plan 5.3): a summary of site.yaml and its source. */
export function ConfigPanel({ siteId }: { siteId: string }) {
  const { m, t } = useI18n();
  const config = useQuery({
    queryKey: keys.panel(siteId, "config", "main"),
    queryFn: () => api.config(siteId, "main"),
  });
  const [view, setView] = useState<"summary" | "raw">("summary");

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
  else body = <Summary summary={config.data.summary} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RefSwitch />
      <div className="flex shrink-0 gap-1 border-b px-2 py-1 text-xs" role="tablist">
        {(["summary", "raw"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
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
            [c.plugins, s.plugins.join(", ")],
            [c.otherSections, s.otherSections.join(", ")],
          ]}
        />
      </Section>
    </div>
  );
}
