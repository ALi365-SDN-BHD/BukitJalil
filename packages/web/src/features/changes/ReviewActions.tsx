import type { ApplyResult, ChangeView } from "@bukitjalil/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { clearSelection, reviewKey, useSelection } from "./selection";

export type Notice = { tone: "ok" | "warn" | "error"; text: string; detail?: string };

/**
 * Apply and reject (plan 7.2). Applying sends the fingerprint the user is looking at; the outcome is told
 * in words, and a failed check can be overridden. The change set itself is refreshed by `change` events.
 */
export function ReviewActions({
  siteId,
  change,
  onNotice,
}: {
  siteId: string;
  change: ChangeView;
  onNotice: (notice: Notice | null) => void;
}) {
  const { m, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const [confirmReject, setConfirmReject] = useState(false);
  const [failed, setFailed] = useState<{ result: ApplyResult; picked: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.change(siteId) });
  // Only part of it, when the user left some files or hunks out (plan 7.5).
  const selection = useSelection(change);
  const picked = selection.request();

  const apply = useMutation({
    mutationFn: (force: boolean) =>
      api.applyChange(change.id, {
        treeHash: change.treeHash,
        force,
        ...(picked ? { baseCommit: change.baseCommit, selection: picked } : {}),
      }),
    onMutate: () => onNotice(null),
    onSuccess: (result) => {
      setFailed(result.outcome === "check_failed" ? { result, picked: JSON.stringify(picked ?? null) } : null);
      if (result.outcome !== "check_failed") clearSelection();
      if (result.outcome === "check_failed") {
        const problem = result.check?.problemCode;
        onNotice({
          tone: "error",
          text: problem ? `${m.changes.checkFailed} ${m.changes.problem[problem]}` : m.changes.checkFailed,
          detail: checkDetail(result),
        });
      } else if (
        (result.outcome === "applied" || result.outcome === "partial") &&
        result.check?.problemCode === "notion"
      ) {
        // Applied without a Bukit check: say so, and where the result shows.
        onNotice({ tone: "warn", text: `${m.changes.outcome[result.outcome]} ${m.changes.appliedUnchecked}` });
      } else {
        const ok = result.outcome === "applied" || result.outcome === "partial";
        onNotice({ tone: ok ? "ok" : "warn", text: m.changes.outcome[result.outcome] });
      }
      void refresh();
    },
    onError: (err) => {
      onNotice({ tone: "error", text: errorOf(err) });
      void refresh();
    },
  });
  const reject = useMutation({
    mutationFn: () => api.rejectChange(change.id),
    onMutate: () => onNotice(null),
    onSuccess: () => {
      setConfirmReject(false);
      onNotice({ tone: "ok", text: m.changes.outcome.rejected });
      void refresh();
    },
    onError: (err) => onNotice({ tone: "error", text: errorOf(err) }),
  });

  const busy = apply.isPending || reject.isPending;
  // A failed check is only worth overriding for the fingerprint and the selection it ran on.
  const canForce =
    !!failed &&
    reviewKey(failed.result.change) === reviewKey(change) &&
    failed.picked === JSON.stringify(picked ?? null);
  const disabled = busy || !change.reviewable;
  // Everything left out: there is nothing to apply.
  const nothing = picked !== undefined && picked.length === 0;

  if (confirmReject) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="reject-confirm">
        <p className="w-full text-sm">{m.changes.rejectConfirm}</p>
        <Button size="sm" variant="destructive" disabled={busy} onClick={() => reject.mutate()}>
          {reject.isPending && <Loader2 className="animate-spin" />} {m.changes.rejectYes}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmReject(false)}>
          {m.changes.cancel}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {selection.dropped && (
        <p className="w-full text-xs text-amber-700 dark:text-amber-400" role="status" data-testid="selection-reset">
          {m.changes.selectionReset}
        </p>
      )}
      {picked && (
        <p className="w-full text-xs text-muted-foreground" data-testid="selection-partial">
          {m.changes.selectionPartial}
        </p>
      )}
      <Button size="sm" disabled={disabled || nothing} onClick={() => apply.mutate(false)} data-testid="change-apply">
        {apply.isPending ? <Loader2 className="animate-spin" /> : <Check />}
        {apply.isPending ? m.changes.applying : picked ? m.changes.applySelected : m.changes.apply}
      </Button>
      {canForce && (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || nothing}
          onClick={() => apply.mutate(true)}
          data-testid="change-apply-force"
        >
          {m.changes.applyAnyway}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => setConfirmReject(true)}
        data-testid="change-reject"
      >
        <X /> {m.changes.reject}
      </Button>
    </div>
  );
}

/** The output of the failed steps, or the reason the check could not run (Bukit's own words). */
function checkDetail(result: ApplyResult): string | undefined {
  const check = result.check;
  if (!check) return undefined;
  if (check.problem) return check.problem;
  const failedSteps = check.steps.filter((s) => !s.passed);
  return failedSteps.map((s) => `$ bukit ${s.command} (exit ${s.exitCode})\n${s.output}`).join("\n\n") || undefined;
}

export function NoticeView({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  const { m } = useI18n();
  const tone =
    notice.tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10"
      : notice.tone === "warn"
        ? "border-amber-500/30 bg-amber-500/10"
        : "border-destructive/30 bg-destructive/10";
  return (
    <div
      role={notice.tone === "error" ? "alert" : "status"}
      className={`rounded-md border p-2 text-sm ${tone}`}
      data-testid="change-notice"
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1">{notice.text}</p>
        {onDismiss && (
          <Button size="icon-xs" variant="ghost" onClick={onDismiss} aria-label={m.changes.dismiss}>
            <X />
          </Button>
        )}
      </div>
      {notice.detail && (
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-background/60 p-2 text-xs whitespace-pre-wrap">
          {notice.detail}
        </pre>
      )}
    </div>
  );
}
