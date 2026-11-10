import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RotateCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BuildButton } from "@/features/builds/builds";
import { useCurrentChange, usePanelRef } from "@/features/changes/hooks";
import { useI18n } from "@/i18n";
import { ApiRequestError, api } from "@/lib/api";
import { shortOid } from "@/lib/format";
import { PanelError, PanelLoading, RefSwitch } from "./common";

/**
 * Preview panel (plan 8.4, 10.2): the newest kept build of the main version, or of the open change set,
 * served on its own preview port and shown in a sandboxed iframe. The version follows the panels' switch;
 * the preview query is invalidated when a build ends, so a new build shows by itself.
 */
export function PreviewPanel({ siteId, readOnly }: { siteId: string; readOnly: boolean }) {
  const [ref] = usePanelRef(siteId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RefSwitch siteId={siteId} />
      {/* Keyed by version, so switching never shows the other version's frame while loading. */}
      <PreviewBody key={ref} siteId={siteId} refName={ref} readOnly={readOnly} />
    </div>
  );
}

function PreviewBody({ siteId, refName, readOnly }: { siteId: string; refName: "main" | "change"; readOnly: boolean }) {
  const { m, t } = useI18n();
  const { change } = useCurrentChange(siteId);
  const preview = useQuery({
    queryKey: ["preview", siteId, refName],
    queryFn: () => api.openPreview(siteId, refName),
    retry: false,
    refetchOnWindowFocus: false,
  });
  // Bumped by the reload button; the iframe is keyed on it so it loads again.
  const [nonce, setNonce] = useState(0);
  const isChange = refName === "change";

  if (preview.isPending) return <PanelLoading />;
  if (preview.error) {
    if (preview.error instanceof ApiRequestError && preview.error.code === "preview.not_built")
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <p>{isChange ? m.preview.changeNotBuilt : m.preview.notBuilt}</p>
          <BuildButton
            siteId={siteId}
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
      {outdated && (
        <div
          className="flex shrink-0 items-center gap-2 border-b bg-amber-500/10 px-2 py-1 text-xs"
          data-testid="preview-outdated"
        >
          <span className="min-w-0 flex-1">{m.preview.changeOutdated}</span>
          <BuildButton
            siteId={siteId}
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
