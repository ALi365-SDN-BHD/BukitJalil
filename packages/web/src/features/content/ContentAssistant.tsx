import { contentKey, type SessionInfo } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Conversation } from "@/features/chat/ChatView";
import type { ToolView } from "@/features/chat/model";
import { SessionMenu, StatusDot, useSessions } from "@/features/chat/sessions";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { NEW_PAGE, useContentParams } from "./hooks";
import { ProposalCard, proposalOf } from "./ProposalCard";

const OPEN_KEY = "bukitjalil.content-ai.open";
const chosenKey = (sourceId: string, databaseId: string) => `bukitjalil.content-ai.session.${sourceId}/${databaseId}`;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not remembered: the panel still works.
  }
}

/**
 * The AI conversation of the open database (content editor and AI design, A3), folded at the bottom of the
 * middle column. Conversations belong to the database; each message carries the entry open as it is sent.
 */
export function ContentAssistant() {
  const { sourceId, databaseId } = useContentParams();
  const sources = useQuery({ queryKey: keys.dataSources, queryFn: api.dataSources });
  if (!sourceId || !databaseId || !sources.data?.some((x) => x.id === sourceId)) return null;
  return <Panel key={`${sourceId}/${databaseId}`} sourceId={sourceId} databaseId={databaseId} />;
}

function Panel({ sourceId, databaseId }: { sourceId: string; databaseId: string }) {
  const { m, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const { pageId } = useContentParams();
  const project = contentKey({ sourceId, databaseId });
  const [open, setOpen] = useState(() => stored(OPEN_KEY) === "1");
  const [chosen, setChosen] = useState(() => stored(chosenKey(sourceId, databaseId)));
  const sessions = useSessions(project);
  const list = sessions.data ?? [];
  // The remembered conversation, else the most recent one.
  const sessionId = list.some((s) => s.id === chosen) ? chosen : (list[0]?.id ?? null);
  const choose = useCallback(
    (id: string | null) => {
      setChosen(id);
      store(chosenKey(sourceId, databaseId), id);
    },
    [sourceId, databaseId],
  );
  const create = useMutation({
    mutationFn: () => api.createSession(project),
    onSuccess: (session) => {
      queryClient.setQueryData<SessionInfo[]>(keys.sessions(project), (old) =>
        old ? [session, ...old.filter((s) => s.id !== session.id)] : [session],
      );
      choose(session.id);
    },
  });
  // The entry open as a message is sent: read when sending, not when the composer was made.
  const entry = useRef<string | null>(null);
  entry.current = pageId && pageId !== NEW_PAGE ? pageId : null;
  const sendExtra = useCallback(() => ({ entryId: entry.current }), []);
  const renderTool = useCallback(
    (tool: ToolView) => {
      const proposal = proposalOf(tool);
      return proposal && sessionId ? (
        <ProposalCard
          tool={tool}
          proposal={proposal}
          sessionId={sessionId}
          sourceId={sourceId}
          databaseId={databaseId}
        />
      ) : null;
    },
    [sessionId, sourceId, databaseId],
  );
  useEffect(() => store(OPEN_KEY, open ? "1" : "0"), [open]);
  const current = list.find((s) => s.id === sessionId) ?? null;

  return (
    <section
      className={`flex shrink-0 flex-col border-t ${open ? "h-[55%] min-h-80" : ""}`}
      aria-label={m.content.ai.title}
      data-testid="content-ai"
      data-open={open}
    >
      <header className="flex shrink-0 items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 text-sm font-medium"
          aria-expanded={open}
          title={open ? m.content.ai.hide : m.content.ai.show}
          data-testid="content-ai-toggle"
          onClick={() => setOpen(!open)}
        >
          <Sparkles className="size-4 shrink-0" />
          <span className="truncate">{m.content.ai.title}</span>
          {current && <StatusDot status={current.status} />}
          {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronUp className="size-4 shrink-0" />}
        </button>
        {open && (
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {list.length > 0 && (
              <select
                className="h-7 min-w-0 max-w-48 truncate rounded-md border bg-background px-1.5 text-xs"
                aria-label={m.content.ai.sessions}
                data-testid="content-ai-sessions"
                value={sessionId ?? ""}
                onChange={(e) => choose(e.target.value)}
              >
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title ?? m.chat.untitled}
                  </option>
                ))}
              </select>
            )}
            {current && <SessionMenu project={project} session={current} />}
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={create.isPending}
              data-testid="content-ai-new"
              onClick={() => create.mutate()}
            >
              <Plus /> {m.content.ai.newChat}
            </Button>
          </div>
        )}
      </header>
      {open && (
        <div className="flex min-h-0 flex-1 flex-col border-t">
          {(sessions.error || create.error) && (
            <p role="alert" className="px-3 py-2 text-xs text-destructive">
              {errorOf(sessions.error ?? create.error)}
            </p>
          )}
          {sessionId ? (
            <Conversation
              key={sessionId}
              sessionId={sessionId}
              project={project}
              readOnly={false}
              onGone={() => choose(null)}
              onForked={choose}
              images={false}
              uploadSite={null}
              emptyText={m.content.ai.chatEmpty}
              notice={<p className="text-xs text-muted-foreground">{m.content.ai.noticeShort}</p>}
              sendExtra={sendExtra}
              renderTool={renderTool}
            />
          ) : (
            sessions.isSuccess && (
              <div className="flex flex-col gap-2 p-4 text-sm text-muted-foreground" data-testid="content-ai-empty">
                <p>{m.content.ai.empty}</p>
                <p className="text-xs">{m.content.ai.notice}</p>
              </div>
            )
          )}
        </div>
      )}
    </section>
  );
}
