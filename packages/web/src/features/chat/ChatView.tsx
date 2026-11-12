import type { ErrorCode, SessionInfo, Site } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitFork, Loader2, Send, Square } from "lucide-react";
import { type KeyboardEvent, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { ReviewCard } from "@/features/changes/ReviewCard";
import { MarkdownView } from "@/features/panels/MarkdownView";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { takeComposerDraft } from "./drafts";
import { type PendingMessage, unseen } from "./live";
import { type ChatItem, chatItems, latestSummary, mergeMessages, modelErrorKind, tailSignature } from "./model";
import { sessionPath } from "./sessions";
import { liveStore, useDeleted, useLive } from "./store";
import { ToolCard } from "./ToolCard";

/** A conversation (plan 10.1): its messages, streamed reply and tool cards, and the composer. */
export function ChatView({ site, sessionId }: { site: Site; sessionId: string }) {
  const { m, errorOf } = useI18n();
  const navigate = useNavigate();
  const deleted = useDeleted(sessionId);
  const detail = useQuery({
    queryKey: keys.session(sessionId),
    queryFn: () => api.session(sessionId),
    retry: false,
    enabled: !deleted,
  });
  const live = useLive(sessionId);

  // Deleted here or in another tab: back to the site home.
  useEffect(() => {
    if (deleted) navigate(`/sites/${site.id}`, { replace: true });
  }, [deleted, navigate, site.id]);

  // Messages that ended live are dropped once the stored session has them.
  useEffect(() => {
    if (detail.data)
      liveStore.prune(
        sessionId,
        detail.data.messages.map((x) => x.message),
      );
  }, [detail.data, sessionId]);

  const messages = detail.data?.messages;
  const running = detail.data?.session.status === "running";
  // Rebuilt when a message or tool changes, not on every streamed delta.
  const items = useMemo(
    () =>
      messages
        ? chatItems(
            mergeMessages(
              messages,
              unseen(
                live.messages,
                messages.map((x) => x.message),
              ),
            ),
            { tools: live.tools, running },
          )
        : [],
    [messages, live.messages, live.tools, running],
  );
  const summary = useMemo(() => latestSummary(items), [items]);

  if (deleted || detail.isPending) return <p className="p-6 text-sm text-muted-foreground">{m.common.loading}</p>;
  if (detail.error) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {errorOf(detail.error)}
      </p>
    );
  }
  const { session } = detail.data;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chat-view">
      <MessageList
        site={site}
        session={session}
        items={items}
        streaming={live.text}
        pending={live.pending}
        error={live.error}
        summary={summary}
      />
      <ReviewCard siteId={site.id} />
      <Composer site={site} session={session} />
    </div>
  );
}

/** Messages, newest at the bottom; follows new output while the user is at the bottom. */
function MessageList({
  site,
  session,
  items,
  streaming,
  pending,
  error,
  summary,
}: {
  site: Site;
  session: SessionInfo;
  items: ChatItem[];
  streaming: string | null;
  pending: PendingMessage[];
  error: string | null;
  summary: string | null;
}) {
  const { m, t, errorText, errorOf } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fork = useMutation({
    mutationFn: (entryId: string) => api.forkSession(session.id, entryId),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: keys.sessions(site.id) });
      navigate(sessionPath(site.id, created.id));
    },
  });
  // Whatever adds output: a message, streamed text, a tool result, a waiting message, an error, a summary.
  const tail = useMemo(() => tailSignature(items), [items]);
  const contentSize = `${tail}:${streaming?.length ?? -1}:${pending.length}:${error}:${summary?.length ?? 0}`;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current && contentSize) el.scrollTop = el.scrollHeight;
  }, [contentSize]);

  const onFork = canForkSite(site) ? fork.mutate : null;
  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      data-testid="message-list"
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {items.length === 0 && streaming === null && pending.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">{m.chat.empty}</p>
      )}
      <ol className="flex flex-col gap-4">
        {items.map((item) => (
          <MessageRow key={item.key} item={item} onFork={onFork} forking={fork.isPending} />
        ))}
        {streaming !== null && (
          <li data-testid="message-streaming">
            <MarkdownView body={streaming} className="p-0" />
          </li>
        )}
        {pending.map((p) => (
          <li key={`pending-${p.id}`} data-testid="message-pending">
            <div className="ml-auto w-fit max-w-[85%] rounded-lg border border-dashed px-3 py-2 text-sm">
              <p className="whitespace-pre-wrap break-words">{p.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">{m.chat.pending}</p>
            </div>
          </li>
        ))}
        {session.status === "running" && streaming === null && (
          <li className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="chat-working">
            <Loader2 className="size-3.5 animate-spin" /> {m.chat.status.running}
          </li>
        )}
      </ol>
      {summary && (
        <section className="mt-4 rounded-md border bg-muted/30 p-3 text-sm" data-testid="chat-summary">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">{m.chat.summary}</h3>
          <p className="whitespace-pre-wrap">{summary}</p>
        </section>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive" data-testid="chat-error">
          {t(m.chat.runFailed, { reason: error in m.errors ? errorText(error as ErrorCode) : error })}
        </p>
      )}
      {fork.error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {errorOf(fork.error)}
        </p>
      )}
    </div>
  );
}

const canForkSite = (site: Site) => !site.readOnly;

/**
 * One message with its fork button. Memoized: the list re-renders on every streamed delta, and parsing
 * every message's Markdown again each time would make long conversations stutter.
 */
const MessageRow = memo(function MessageRow({
  item,
  onFork,
  forking,
}: {
  item: ChatItem;
  onFork: ((entryId: string) => void) | null;
  forking: boolean;
}) {
  const { m } = useI18n();
  const entryId = item.entryId;
  return (
    <li className="group relative" data-testid={`message-${item.kind}`}>
      {item.kind === "user" ? <UserMessage item={item} /> : <AssistantMessage item={item} />}
      {onFork && entryId && (
        <button
          type="button"
          className="absolute -top-2 right-0 hidden items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground shadow-xs hover:text-foreground group-hover:flex group-focus-within:flex"
          title={m.chat.forkHint}
          data-testid="fork-message"
          disabled={forking}
          onClick={() => onFork(entryId)}
        >
          <GitFork className="size-3" /> {m.chat.fork}
        </button>
      )}
    </li>
  );
});

function UserMessage({ item }: { item: Extract<ChatItem, { kind: "user" }> }) {
  const { m, t } = useI18n();
  return (
    <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-sm">
      <p className="whitespace-pre-wrap break-words">{item.text}</p>
      {item.images > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">{t(m.chat.images, { count: item.images })}</p>
      )}
    </div>
  );
}

function AssistantMessage({ item }: { item: Extract<ChatItem, { kind: "assistant" }> }) {
  const { m } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      {item.parts.map((part, i) =>
        part.kind === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one message in order
          <MarkdownView key={i} body={part.text} className="p-0" />
        ) : part.kind === "thinking" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one message in order
          <details key={i} className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">{m.chat.thinking}</summary>
            <p className="mt-1 whitespace-pre-wrap">{part.text}</p>
          </details>
        ) : (
          <ToolCard key={part.tool.id} tool={part.tool} />
        ),
      )}
      {item.aborted && <p className="text-xs text-muted-foreground">{m.chat.aborted}</p>}
      {item.error && <ModelError message={item.error} />}
    </div>
  );
}

/**
 * The input (plan 10.1). Idle: Enter sends. While the session runs, a message is added to the run right
 * away (steer) or after it (follow-up), and the run can be stopped.
 */
function Composer({ site, session }: { site: Site; session: SessionInfo }) {
  const { m, errorOf } = useI18n();
  const [text, setText] = useState(() => takeComposerDraft(session.id) ?? "");
  const [failedText, setFailedText] = useState<string | null>(null);
  const textRef = useRef(text);
  const running = session.status === "running";
  // The message leaves the box at once and shows as waiting until the session takes it in (the events
  // remove it); on failure it comes back to the box, unless something new was typed meanwhile.
  const send = useMutation({
    mutationFn: (vars: { mode: "prompt" | "steer" | "followUp"; text: string; pendingId: number }) =>
      api.sendMessage(session.id, { text: vars.text, mode: vars.mode }),
    onError: (_err, vars) => {
      liveStore.removePending(session.id, vars.pendingId);
      // With an empty box, put the message back as before. If the user has typed something else, keep it and
      // offer the failed text as a retry instead of overwriting what they typed.
      if (textRef.current === "") {
        textRef.current = vars.text;
        setText(vars.text);
      } else {
        setFailedText(vars.text);
      }
    },
  });
  const submit = (mode: "prompt" | "steer" | "followUp") => {
    if (text.trim() === "" || send.isPending) return;
    const pendingId = liveStore.addPending(session.id, text);
    textRef.current = "";
    setText("");
    send.mutate({ mode, text, pendingId });
  };
  const stop = useMutation({ mutationFn: () => api.abortSession(session.id) });
  const disabled = !!site.readOnly;
  const empty = text.trim() === "";

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Esc stops the run (plan M5 layer 3); not while an IME candidate list is open.
    if (e.key === "Escape" && !e.nativeEvent.isComposing && session.status !== "idle" && !stop.isPending) {
      e.preventDefault();
      stop.mutate();
      return;
    }
    // Enter while composing (IME) picks a candidate, it does not send.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit(running ? "steer" : "prompt");
  };

  return (
    <div className="shrink-0 border-t p-3">
      {disabled ? (
        <p className="text-sm text-muted-foreground">{m.conversation.readOnlyHint}</p>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(running ? "steer" : "prompt");
          }}
        >
          {session.status === "queued" && <p className="text-xs text-amber-600 dark:text-amber-400">{m.chat.queued}</p>}
          <textarea
            className="min-h-16 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            rows={3}
            value={text}
            maxLength={100_000}
            placeholder={running ? m.chat.placeholderRunning : m.chat.placeholder}
            aria-label={m.chat.placeholder}
            data-testid="composer-input"
            onChange={(e) => {
              textRef.current = e.target.value;
              setText(e.target.value);
            }}
            onKeyDown={onKeyDown}
          />
          <div className="flex items-center gap-2">
            {(send.error || stop.error) && (
              <p role="alert" className="min-w-0 flex-1 text-xs text-destructive" data-testid="composer-error">
                {errorOf(send.error ?? stop.error)}
              </p>
            )}
            {failedText && (
              <p className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1">{m.chat.sendFailed}</span>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  data-testid="restore-failed-message"
                  onClick={() => {
                    textRef.current = failedText;
                    setText(failedText);
                    setFailedText(null);
                  }}
                >
                  {m.common.retry}
                </Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => setFailedText(null)}>
                  {m.common.cancel}
                </Button>
              </p>
            )}
            <div className="ml-auto flex items-center gap-2">
              {session.status !== "idle" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="stop-session"
                  disabled={stop.isPending}
                  onClick={() => stop.mutate()}
                >
                  {stop.isPending ? <Loader2 className="animate-spin" /> : <Square />}
                  {stop.isPending ? m.chat.stopping : m.chat.stop}
                </Button>
              )}
              {running && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  title={m.chat.followUpHint}
                  data-testid="send-followup"
                  disabled={empty || send.isPending}
                  onClick={() => submit("followUp")}
                >
                  {m.chat.followUp}
                </Button>
              )}
              <Button
                type="submit"
                size="sm"
                title={running ? m.chat.steerHint : undefined}
                data-testid="send-message"
                disabled={empty || send.isPending}
              >
                {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                {running ? m.chat.steer : m.chat.send}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

/** A provider's error on an answer: what it means in plain words, and the provider's own text. */
function ModelError({ message }: { message: string }) {
  const { m } = useI18n();
  const kind = modelErrorKind(message);
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 text-xs text-destructive"
      data-testid="model-error"
      data-kind={kind ?? "other"}
    >
      <p>{m.chat.modelError[kind ?? "other"]}</p>
      <details className="text-muted-foreground">
        <summary className="cursor-pointer">{m.chat.modelError.details}</summary>
        <p className="mt-1 whitespace-pre-wrap break-all">{message}</p>
      </details>
    </div>
  );
}
