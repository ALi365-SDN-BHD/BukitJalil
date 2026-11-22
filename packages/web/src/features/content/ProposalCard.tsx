import type { ContentProposal, ContentProposalState, ContentValue, ErrorCode } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import type { ToolView } from "@/features/chat/model";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { contentPagePath } from "@/lib/project";
import { lineDiff } from "./diff";
import { draftKey, useDraft } from "./draft";

/** The tools whose results are proposals (content editor and AI design, A2). */
const PROPOSE_TOOLS = new Set(["propose_update", "propose_create"]);

/** The proposal a tool call recorded, or null for any other tool call (and one that failed or still runs). */
export function proposalOf(tool: ToolView): ContentProposal | null {
  if (!PROPOSE_TOOLS.has(tool.name) || tool.state !== "ok") return null;
  const proposal = (tool.details as { proposal?: ContentProposal } | undefined)?.proposal;
  return proposal && typeof proposal === "object" ? proposal : null;
}

/** How a proposed value reads, like the server's display text of a property. */
export function valueText(value: ContentValue): string {
  switch (value.type) {
    case "title":
    case "rich_text":
      return value.text;
    case "number":
      return value.number === null ? "" : String(value.number);
    case "select":
    case "status":
      return value.option ?? "";
    case "multi_select":
      return value.options.join(", ");
    case "date":
      return value.start ? (value.end ? `${value.start} → ${value.end}` : value.start) : "";
    case "checkbox":
      return value.checked ? "✓" : "✗";
    default:
      return value.text ?? "";
  }
}

const PENDING = (callId: string): ContentProposalState => ({ callId, status: "pending", entryId: null, error: null });

/**
 * A proposal of the content assistant (content editor and AI design, A3): the properties before and after
 * and the body's changed lines, written to Notion only on "Write to Notion". An update waits while the entry
 * has unsaved edits in the editor, so neither overwrites the other.
 */
export function ProposalCard({
  tool,
  proposal,
  sessionId,
  sourceId,
  databaseId,
}: {
  tool: ToolView;
  proposal: ContentProposal;
  sessionId: string;
  sourceId: string;
  databaseId: string;
}) {
  const { m, t, errorText, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const states = useQuery({ queryKey: keys.proposals(sessionId), queryFn: () => api.proposals(sessionId) });
  const state = states.data?.find((s) => s.callId === tool.id) ?? PENDING(tool.id);
  const draft = useDraft(proposal.entryId ? draftKey(sourceId, databaseId, proposal.entryId) : "");
  const blocked = proposal.kind === "update" && draft.dirty;
  const decide = useMutation({
    mutationFn: (decision: "apply" | "reject") => api.decideProposal(sessionId, tool.id, decision),
    onSuccess: (next) => {
      queryClient.setQueryData<ContentProposalState[]>(keys.proposals(sessionId), (list) => [
        ...(list ?? []).filter((s) => s.callId !== next.callId),
        next,
      ]);
      if (next.status !== "applied" && next.status !== "failed") return;
      // What was written shows in the list and, if it is open, in the editor.
      void queryClient.invalidateQueries({ queryKey: keys.contentEntries(sourceId, databaseId) });
      if (next.entryId) {
        void queryClient.invalidateQueries({ queryKey: keys.contentPage(sourceId, databaseId, next.entryId) });
        void queryClient.invalidateQueries({ queryKey: keys.contentBody(sourceId, databaseId, next.entryId) });
      }
    },
  });
  const title = proposal.title || m.content.ai.proposal.untitled;
  const open = state.status === "pending" || (state.status === "failed" && state.error !== "content.proposal_partial");
  const failure = state.error ? (state.error in m.errors ? errorText(state.error as ErrorCode) : state.error) : null;

  return (
    <section
      className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 text-sm"
      data-testid="proposal-card"
      data-kind={proposal.kind}
      data-status={state.status}
    >
      <h4 className="font-medium">
        {t(proposal.kind === "update" ? m.content.ai.proposal.update : m.content.ai.proposal.create, { title })}
      </h4>
      {proposal.properties.length > 0 && (
        <table className="w-full table-fixed text-xs" data-testid="proposal-properties">
          <caption className="mb-1 text-left text-muted-foreground">{m.content.ai.proposal.properties}</caption>
          <tbody>
            {proposal.properties.map((p) => (
              <tr key={p.name} className="align-top">
                <th scope="row" className="w-1/4 truncate py-0.5 pr-2 text-left font-normal text-muted-foreground">
                  {p.name}
                </th>
                <td className="py-0.5 break-words">
                  {p.before !== null && (
                    <>
                      <del className="text-destructive/80">{p.before || m.content.ai.proposal.empty}</del>{" "}
                      <span aria-hidden>→</span>{" "}
                    </>
                  )}
                  <ins className="text-emerald-700 no-underline dark:text-emerald-400">
                    {valueText(p.after) || m.content.ai.proposal.empty}
                  </ins>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {proposal.body && <BodyDiff before={proposal.body.before ?? ""} after={proposal.body.after} />}
      {state.status === "applied" && (
        <p className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400" role="status">
          <Check className="size-3.5" /> {m.content.ai.proposal.applied}
          {state.entryId && (
            <Link
              className="text-foreground underline"
              to={contentPagePath(sourceId, databaseId, state.entryId)}
              data-testid="proposal-open"
            >
              {m.content.ai.proposal.open}
            </Link>
          )}
        </p>
      )}
      {state.status === "rejected" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <X className="size-3.5" /> {m.content.ai.proposal.rejected}
        </p>
      )}
      {failure && (
        <p role="alert" className="text-xs text-destructive" data-testid="proposal-error">
          {t(m.content.ai.proposal.failed, { reason: failure })}
        </p>
      )}
      {decide.error && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(decide.error)}
        </p>
      )}
      {open && (
        <>
          {blocked && <p className="text-xs text-amber-700 dark:text-amber-400">{m.content.ai.proposal.draft}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={decide.isPending}
              data-testid="proposal-reject"
              onClick={() => decide.mutate("reject")}
            >
              {m.content.ai.proposal.reject}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={decide.isPending || blocked}
              data-testid="proposal-apply"
              onClick={() => decide.mutate("apply")}
            >
              {decide.isPending && <Loader2 className="animate-spin" />}
              {decide.isPending ? m.content.ai.proposal.applying : m.content.ai.proposal.apply}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function BodyDiff({ before, after }: { before: string; after: string }) {
  const { m } = useI18n();
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  return (
    <section className="flex flex-col gap-1">
      <h5 className="text-xs text-muted-foreground">{m.content.ai.proposal.body}</h5>
      <pre
        className="max-h-72 overflow-auto rounded border bg-background p-2 text-xs whitespace-pre-wrap break-words"
        data-testid="proposal-body"
      >
        {lines.map((line, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: lines of one diff in order
            key={i}
            className={
              line.kind === "added"
                ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                : line.kind === "removed"
                  ? "bg-destructive/10 text-destructive line-through"
                  : "text-muted-foreground"
            }
          >
            <span aria-hidden className="mr-1 select-none">
              {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
            </span>
            {line.text || " "}
          </div>
        ))}
      </pre>
    </section>
  );
}
