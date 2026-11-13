import { ChevronDown, ChevronUp, FileDiff } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { ChangedFileList } from "./ChangedFileList";
import { useCurrentChange } from "./hooks";
import { NotionChangesNote } from "./NotionChangesNote";
import { RestoreNote } from "./RestoreNote";
import { type Notice, NoticeView, ReviewActions } from "./ReviewActions";

const LISTED = 8;

/**
 * The review card under the conversation (plan 10.2): the AI's summary, the changed files, apply and
 * reject. It belongs to the site's change set, so every session of the site shows the same one; while a
 * session runs the buttons wait for the run to end and its snapshot.
 */
export function ReviewCard({ siteId }: { siteId: string }) {
  const { m, t } = useI18n();
  const { change } = useCurrentChange(siteId);
  const [collapsed, setCollapsed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [, setParams] = useSearchParams();
  const hasFiles = !!change && (change.files.length > 0 || change.filesTruncated);

  if (!hasFiles) {
    return notice ? (
      <div className="border-t px-4 py-2">
        <NoticeView notice={notice} onDismiss={() => setNotice(null)} />
      </div>
    ) : null;
  }
  const viewDiff = (path?: string) =>
    setParams((p) => {
      p.set("panel", "changes");
      p.delete("file");
      if (path) p.set("diff", path);
      else p.delete("diff");
      return p;
    });

  return (
    <section
      className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-auto border-t bg-muted/30 px-4 py-3"
      data-testid="review-card"
    >
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
          {m.changes.card} · {t(m.changes.files, { count: change.files.length })}
        </h3>
        <Button size="xs" variant="ghost" onClick={() => viewDiff()} data-testid="review-view-diff">
          <FileDiff /> {m.changes.viewDiff}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? m.changes.expand : m.changes.collapse}
          title={collapsed ? m.changes.expand : m.changes.collapse}
          data-testid="review-collapse"
        >
          {collapsed ? <ChevronDown /> : <ChevronUp />}
        </Button>
      </div>
      {!collapsed && (
        <>
          {change.restoreOf && <RestoreNote commit={change.restoreOf} />}
          <NotionChangesNote changes={change.notionChanges} />
          <p className="whitespace-pre-wrap text-sm text-muted-foreground" data-testid="review-summary">
            {change.summary?.trim() || m.changes.noSummary}
          </p>
          <ChangedFileList files={change.files.slice(0, LISTED)} onSelect={viewDiff} compact />
          {(change.files.length > LISTED || change.filesTruncated) && (
            <button type="button" className="w-fit text-xs text-muted-foreground underline" onClick={() => viewDiff()}>
              {m.changes.more}
            </button>
          )}
          {!change.reviewable && (
            <p className="text-xs text-muted-foreground" data-testid="review-working">
              {m.changes.working}
            </p>
          )}
          {notice && <NoticeView notice={notice} onDismiss={() => setNotice(null)} />}
          <ReviewActions siteId={siteId} change={change} onNotice={setNotice} />
        </>
      )}
    </section>
  );
}
