import type { ProjectKey } from "@bukitjalil/shared";
import { FileText } from "lucide-react";
import { useSearchParams } from "react-router";
import { usePanelRef } from "@/features/changes/hooks";
import { useI18n } from "@/i18n";
import { PanelError, PanelLoading, RefSwitch, Section } from "./common";
import { openFile, useProjectDir } from "./projectDir";

/**
 * Sample content of a theme project (theme development design 2, 3.4): the posts and pages that show every
 * page type. They exist only to preview the theme; opening one shows it in the files panel.
 */
export function SamplesPanel({ project }: { project: ProjectKey }) {
  const { m } = useI18n();
  const [ref] = usePanelRef(project);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RefSwitch project={project} />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4" data-testid="samples-panel">
        <p className="text-xs text-muted-foreground">{m.samples.hint}</p>
        <SampleList project={project} refName={ref} dir="content/posts" title={m.samples.posts} />
        <SampleList project={project} refName={ref} dir="content/pages" title={m.samples.pages} />
      </div>
    </div>
  );
}

function SampleList({
  project,
  refName,
  dir,
  title,
}: {
  project: ProjectKey;
  refName: "main" | "change";
  dir: string;
  title: string;
}) {
  const { m, t } = useI18n();
  const [, setParams] = useSearchParams();
  const list = useProjectDir(project, refName, dir);
  const files = list.data?.filter((e) => e.kind === "file" && /\.(md|markdown)$/i.test(e.name)) ?? [];
  return (
    <Section title={`${title} (${t(m.theme.count, { count: files.length })})`}>
      {list.isPending ? (
        <PanelLoading />
      ) : list.error ? (
        <PanelError error={list.error} />
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">{m.common.none}</p>
      ) : (
        <ul className="flex flex-col text-sm">
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent/60"
                data-testid="sample-item"
                onClick={() => setParams((p) => openFile(p, f.path), { replace: true })}
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
