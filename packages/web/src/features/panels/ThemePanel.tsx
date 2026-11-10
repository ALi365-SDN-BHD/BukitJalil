import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { CodeView } from "./CodeView";
import { PanelError, PanelLoading, RefSwitch, Section } from "./common";

/** Theme panel (plan 5.3): theme.yaml, the theme's files and the theme parameters in site.yaml. */
export function ThemePanel({ siteId }: { siteId: string }) {
  const { m, t } = useI18n();
  const theme = useQuery({ queryKey: keys.panel(siteId, "theme", "main"), queryFn: () => api.theme(siteId, "main") });

  let body: React.ReactNode;
  if (theme.isPending) body = <PanelLoading />;
  else if (theme.error) body = <PanelError error={theme.error} />;
  else {
    const d = theme.data;
    if (d.name === null) body = <p className="p-6 text-sm text-muted-foreground">{m.theme.none}</p>;
    else
      body = (
        <div className="flex flex-col gap-5 p-4">
          <h2 className="text-base font-semibold" data-testid="theme-name">
            {d.name}
          </h2>
          {d.dir === null ? (
            <p className="text-sm text-destructive">{t(m.theme.missingDir, { dir: `themes/${d.name}` })}</p>
          ) : (
            <>
              <Section title={m.theme.manifest}>
                {d.error && <p className="text-sm text-destructive">{d.error}</p>}
                {d.manifestRaw === null ? (
                  <p className="text-sm text-muted-foreground">{m.theme.noManifest}</p>
                ) : (
                  <div className="rounded-md border">
                    <CodeView code={d.manifestRaw} lang="yaml" />
                  </div>
                )}
              </Section>
              {d.truncated && <p className="text-sm text-muted-foreground">{m.theme.truncated}</p>}
              <FileList title={m.theme.layouts} files={d.layouts} />
              <FileList title={m.theme.assets} files={d.assets} />
              <FileList title={m.theme.static} files={d.static} />
            </>
          )}
          {d.params !== null && d.params !== undefined && (
            <Section title={m.theme.params}>
              <div className="rounded-md border">
                <CodeView code={JSON.stringify(d.params, null, 2)} lang="json" />
              </div>
            </Section>
          )}
        </div>
      );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RefSwitch />
      <div className="min-h-0 flex-1 overflow-auto" data-testid="theme-panel">
        {body}
      </div>
    </div>
  );
}

function FileList({ title, files }: { title: string; files: string[] }) {
  const { m, t } = useI18n();
  return (
    <details className="text-sm" open={files.length > 0 && files.length <= 30}>
      <summary className="cursor-pointer font-medium">
        {title} <span className="text-muted-foreground">({t(m.theme.count, { count: files.length })})</span>
      </summary>
      {files.length === 0 ? (
        <p className="mt-1 text-muted-foreground">{m.common.none}</p>
      ) : (
        <ul className="mt-1 columns-1 font-mono text-xs sm:columns-2">
          {files.map((f) => (
            <li key={f} className="truncate" title={f}>
              {f}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
