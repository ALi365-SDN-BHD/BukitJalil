import type { ProjectKey, TreeEntryView } from "@bukitjalil/shared";
import { FileText } from "lucide-react";
import { useSearchParams } from "react-router";
import { usePanelRef } from "@/features/changes/hooks";
import { useI18n } from "@/i18n";
import { fileUrl } from "@/lib/api";
import { PanelError, PanelLoading, RefSwitch, Section } from "./common";
import { openFile, useProjectDir } from "./projectDir";

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

/**
 * Reference material of a theme project (theme development design 2, 4.2, 6.2): the images the user attached
 * (_reference/) and pages captured from the user's own site (_capture/). The AI reads them; it cannot write them.
 */
export function ReferencePanel({ project }: { project: ProjectKey }) {
  const { m } = useI18n();
  const [ref] = usePanelRef(project);
  const images = useProjectDir(project, ref, "_reference");
  const captures = useProjectDir(project, ref, "_capture");
  const empty = images.data?.length === 0 && captures.data?.length === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RefSwitch project={project} />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4" data-testid="reference-panel">
        {empty && <p className="text-sm text-muted-foreground">{m.reference.empty}</p>}
        {images.isPending ? (
          <PanelLoading />
        ) : images.error ? (
          <PanelError error={images.error} />
        ) : (
          images.data.length > 0 && (
            <Section title={m.reference.images}>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
                {images.data.map((e) =>
                  e.kind === "file" && IMAGE.test(e.name) ? (
                    <li key={e.path}>
                      <a
                        href={fileUrl(project, ref, e.path, "raw")}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={e.name}
                        className="block"
                      >
                        <img
                          src={fileUrl(project, ref, e.path, "raw")}
                          alt={e.name}
                          loading="lazy"
                          className="aspect-square w-full rounded border bg-muted object-cover"
                          data-testid="reference-image"
                        />
                      </a>
                    </li>
                  ) : (
                    <FileItem key={e.path} entry={e} />
                  ),
                )}
              </ul>
            </Section>
          )
        )}
        {captures.data && captures.data.length > 0 && (
          <Section title={m.reference.captures}>
            <ul className="flex flex-col">
              {captures.data.map((e) => (
                <FileItem key={e.path} entry={e} />
              ))}
            </ul>
          </Section>
        )}
        {captures.error && <PanelError error={captures.error} />}
      </div>
    </div>
  );
}

function FileItem({ entry }: { entry: TreeEntryView }) {
  const [, setParams] = useSearchParams();
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent/60"
        onClick={() => setParams((p) => openFile(p, entry.path), { replace: true })}
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</span>
      </button>
    </li>
  );
}
