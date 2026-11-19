import type { ProjectKey } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RotateCw, Upload } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { BuildButton, NotionOfflineNote, useBuilds } from "@/features/builds/builds";
import { useCurrentChange, usePanelRef } from "@/features/changes/hooks";
import { useI18n } from "@/i18n";
import { ApiRequestError, api, keys } from "@/lib/api";
import { shortOid } from "@/lib/format";
import { PanelError, PanelLoading, RefSwitch } from "./common";

/**
 * Preview panel (plan 8.4, 10.2): the newest kept build of the main version, or of the open change set,
 * served on its own preview port and shown in a sandboxed iframe. The version follows the panels' switch;
 * the preview query is invalidated when a build ends, so a new build shows by itself.
 */
export function PreviewPanel({ project, readOnly }: { project: ProjectKey; readOnly: boolean }) {
  const [ref] = usePanelRef(project);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RefSwitch project={project} />
      {/* Keyed by version, so switching never shows the other version's frame while loading. */}
      <PreviewBody key={ref} project={project} refName={ref} readOnly={readOnly} />
    </div>
  );
}

function PreviewBody({
  project,
  refName,
  readOnly,
}: {
  project: ProjectKey;
  refName: "main" | "change";
  readOnly: boolean;
}) {
  const { m, t } = useI18n();
  const { change } = useCurrentChange(project);
  const builds = useBuilds(project);
  // The open change set's newest build ended without Notion data (plan 5.5)...
  const notionBlocked =
    refName === "change" &&
    !!change &&
    builds.data?.builds.find((b) => b.ref === "change" && b.changeSetId === change.id)?.outcome === "notion";
  // ...and still no formal build has recorded any.
  const data = useQuery({
    queryKey: keys.panel(project, "data", "main"),
    queryFn: () => api.data(project, "main"),
    enabled: notionBlocked,
  });
  const preview = useQuery({
    queryKey: ["preview", project, refName],
    queryFn: () => api.openPreview(project, refName),
    retry: false,
    refetchOnWindowFocus: false,
  });
  // Bumped by the reload button; the iframe is keyed on it so it loads again.
  const [nonce, setNonce] = useState(0);
  const isChange = refName === "change";
  const [, setParams] = useSearchParams();
  // Uploads have one queue and one file list, both in the changes panel; this button hands over to it and
  // its effect opens the picker on arrival (upload=1).
  const goUpload = () =>
    setParams(
      (p) => {
        p.set("panel", "changes");
        p.delete("file");
        p.set("upload", "1");
        return p;
      },
      { replace: true },
    );

  if (preview.isPending) return <PanelLoading />;
  if (preview.error) {
    if (preview.error instanceof ApiRequestError && preview.error.code === "preview.not_built")
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <p>{isChange ? m.preview.changeNotBuilt : m.preview.notBuilt}</p>
          {/* A change of a Notion site builds from the last formal build's Notion data (plan 5.5). */}
          {notionBlocked && data.data && data.data.notionSnapshot === null && (
            <p className="text-amber-700 dark:text-amber-400" data-testid="preview-notion-missing">
              {m.notionSnapshot.problem.missing}
            </p>
          )}
          <BuildButton
            project={project}
            refName={refName}
            disabled={readOnly || (isChange && !change?.reviewable)}
            label={isChange ? m.preview.buildChange : undefined}
          />
        </div>
      );
    return <PanelError error={preview.error} />;
  }
  const p = preview.data;
  // The AI changed more since this build: the review shows newer files than the preview.
  const outdated = isChange && !!change && change.snapshotCommit !== p.commit;
  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2 text-xs">
        <span className="min-w-0 flex-1 truncate text-muted-foreground" data-testid="preview-info">
          {t(m.preview.showing, { build: p.buildId.slice(0, 7), commit: shortOid(p.commit) })}
        </span>
        <Button size="xs" variant="ghost" data-testid="preview-upload" title={m.media.uploadHint} onClick={goUpload}>
          <Upload /> {m.media.upload}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            setNonce((n) => n + 1);
            void preview.refetch();
          }}
        >
          <RotateCw /> {m.preview.reload}
        </Button>
        <Button asChild size="xs" variant="ghost">
          <a href={p.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink /> {m.preview.newTab}
          </a>
        </Button>
      </div>
      {p.notionOffline && (
        <div className="shrink-0 border-b bg-sky-500/10 px-2 py-1">
          <NotionOfflineNote data={p.notionOffline} testId="preview-notion" />
        </div>
      )}
      {outdated && (
        <div
          className="flex shrink-0 items-center gap-2 border-b bg-amber-500/10 px-2 py-1 text-xs"
          data-testid="preview-outdated"
        >
          <span className="min-w-0 flex-1">{m.preview.changeOutdated}</span>
          <BuildButton
            project={project}
            refName="change"
            disabled={readOnly || !change.reviewable}
            label={m.preview.rebuild}
          />
        </div>
      )}
      {/* The preview server also sends a CSP sandbox; allow-scripts without allow-same-origin keeps the
          page in an opaque origin either way. */}
      <iframe
        key={`${p.buildId}-${nonce}`}
        src={p.url}
        title={m.preview.frameTitle}
        sandbox="allow-scripts"
        className="min-h-0 w-full flex-1 bg-white"
        data-testid="preview-frame"
      />
    </>
  );
}
