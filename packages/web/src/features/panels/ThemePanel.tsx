import type { ProjectKey, ThemeCoverage, ThemeToken } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck } from "lucide-react";
import { usePanelRef } from "@/features/changes/hooks";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { CodeView } from "./CodeView";
import { PanelError, PanelLoading, RefSwitch, Section } from "./common";

/** Theme panel (plan 5.3): theme.yaml, the theme's files and the theme parameters in site.yaml. */
export function ThemePanel({ project }: { project: ProjectKey }) {
  const [ref] = usePanelRef(project);
  const { m, t } = useI18n();
  const theme = useQuery({ queryKey: keys.panel(project, "theme", ref), queryFn: () => api.theme(project, ref) });

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
              {d.coverage && <Coverage coverage={d.coverage} />}
              {d.colors && d.colors.length > 0 && <Colors colors={d.colors} />}
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
          {d.siteTheme !== null && d.siteTheme !== undefined && (
            <Section title={m.theme.siteTheme}>
              <div className="rounded-md border">
                <CodeView code={JSON.stringify(d.siteTheme, null, 2)} lang="json" />
              </div>
            </Section>
          )}
          {d.siteTheme == null && d.params !== null && d.params !== undefined && (
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
      <RefSwitch project={project} />
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

/** What the theme covers (theme development design 2): page types with templates, and what is missing. */
function Coverage({ coverage }: { coverage: ThemeCoverage }) {
  const { m, t } = useI18n();
  if ("error" in coverage) {
    return (
      <Section title={m.theme.coverage}>
        <p className="text-sm text-destructive">{coverage.error}</p>
      </Section>
    );
  }
  const declared = new Map(coverage.templates.map((x) => [x.pageType, x]));
  const label = (type: string) => m.theme.pageTypes[type as keyof typeof m.theme.pageTypes] ?? type;
  const extras: [string, boolean][] = [
    [m.theme.tokensFile, coverage.tokens],
    [m.theme.searchPage, coverage.searchPage],
    [m.theme.notFoundPage, coverage.notFoundPage],
  ];
  return (
    <Section title={m.theme.coverage} testId="theme-coverage">
      <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        {Object.keys(m.theme.pageTypes).map((type) => {
          const entry = declared.get(type);
          const ok = !!entry?.exists;
          return (
            <li key={type} className="flex min-w-0 items-center gap-1.5" data-testid={`coverage-${type}`} data-ok={ok}>
              <Mark ok={ok} />
              <span className="min-w-0 truncate">{label(type)}</span>
              {entry?.template && (
                <code className="min-w-0 truncate text-xs text-muted-foreground" title={entry.template}>
                  {entry.template}
                </code>
              )}
            </li>
          );
        })}
        {extras.map(([name, ok]) => (
          <li key={name} className="flex items-center gap-1.5">
            <Mark ok={ok} />
            {name}
          </li>
        ))}
      </ul>
      {coverage.missingPageTypes.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t(m.theme.missingPageTypes, { types: coverage.missingPageTypes.map(label).join(", ") })}
        </p>
      )}
      {coverage.missingTemplateFiles.length > 0 && (
        <p className="text-xs text-destructive">
          {t(m.theme.missingTemplateFiles, { files: coverage.missingTemplateFiles.join(", ") })}
        </p>
      )}
      {coverage.missingIncludes.length > 0 && (
        <div className="text-xs text-destructive">
          <p>{m.theme.missingIncludes}</p>
          <ul className="ml-4 list-disc font-mono">
            {coverage.missingIncludes.map((x) => (
              <li key={`${x.file}:${x.include}`}>
                {x.file} → {x.include}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function Mark({ ok }: { ok: boolean }) {
  const { m } = useI18n();
  return ok ? (
    <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-label={m.theme.present} />
  ) : (
    <CircleAlert className="size-4 shrink-0 text-amber-600" aria-label={m.theme.absent} />
  );
}

/** The token colors as swatches; values are checked as colors by the server. */
function Colors({ colors }: { colors: ThemeToken[] }) {
  const { m } = useI18n();
  return (
    <Section title={m.theme.colors} testId="theme-colors">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 text-xs">
        {colors.map((c) => (
          <li key={c.name} className="flex min-w-0 items-center gap-2">
            <span className="size-6 shrink-0 rounded border" style={{ background: c.value }} />
            <span className="min-w-0">
              <span className="block truncate font-medium">{c.name}</span>
              <code className="block truncate text-muted-foreground">{c.value}</code>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
