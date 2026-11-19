import { type ErrorCode, isThemeKey, MAX_REFERENCE_IMAGES, type SessionInfo } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitFork, ImagePlus, Loader2, Paperclip, Send, Square, X } from "lucide-react";
import {
  type KeyboardEvent,
  memo,
  type Ref,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { ReviewCard } from "@/features/changes/ReviewCard";
import { MediaUpload, type MediaUploadHandle } from "@/features/media/MediaUpload";
import { MarkdownView } from "@/features/panels/MarkdownView";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { type ProjectInfo, projectPath } from "@/lib/project";
import {
  ATTACH_ACCEPT,
  type Attachment,
  type AttachProblem,
  imageUrl,
  readAttachments,
  selectedModelReadsImages,
} from "./attachments";
import { composerDraft, composerImages, saveComposer } from "./drafts";
import { type PendingMessage, unseen } from "./live";
import { type ChatItem, chatItems, latestSummary, mergeMessages, modelErrorKind, tailSignature } from "./model";
import { sessionPath } from "./sessions";
import { liveStore, useDeleted, useLive } from "./store";
import { ToolCard } from "./ToolCard";

/** A conversation (plan 10.1): its messages, streamed reply and tool cards, and the composer. */
export function ChatView({ project, sessionId }: { project: ProjectInfo; sessionId: string }) {
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
  const uploader = useRef<MediaUploadHandle>(null);
  const composer = useRef<ComposerHandle>(null);

  // Deleted here or in another tab: back to the project's home.
  useEffect(() => {
    if (deleted) navigate(projectPath(project.key), { replace: true });
  }, [deleted, navigate, project.key]);

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
    <section
      className="flex h-full min-h-0 flex-col"
      data-testid="chat-view"
      aria-label={m.conversation.title}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length === 0) return;
        // A theme project has no media upload: files become the message's reference images.
        if (isThemeKey(project.key)) composer.current?.addImages(Array.from(e.dataTransfer.files));
        else uploader.current?.addFiles(e.dataTransfer.files);
      }}
    >
      <MessageList
        project={project}
        session={session}
        items={items}
        streaming={live.text}
        pending={live.pending}
        error={live.error}
        summary={summary}
      />
      <ReviewCard project={project.key} />
      <Composer ref={composer} project={project} session={session} uploader={uploader} />
    </section>
  );
}

/** Messages, newest at the bottom; follows new output while the user is at the bottom. */
function MessageList({
  project,
  session,
  items,
  streaming,
  pending,
  error,
  summary,
}: {
  project: ProjectInfo;
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
      void queryClient.invalidateQueries({ queryKey: keys.sessions(project.key) });
      navigate(sessionPath(project.key, created.id));
    },
  });
  // Whatever adds output: a message, streamed text, a tool result, a waiting message, an error, a summary.
  const tail = useMemo(() => tailSignature(items), [items]);
  const contentSize = `${tail}:${streaming?.length ?? -1}:${pending.length}:${error}:${summary?.length ?? 0}`;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current && contentSize) el.scrollTop = el.scrollHeight;
  }, [contentSize]);

  const onFork = project.readOnly ? null : fork.mutate;
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
      {item.images.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1" aria-label={t(m.chat.images, { count: item.images.length })}>
          {item.images
            .flatMap((image) => imageUrl(image) ?? [])
            .map((src, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: images of one message in order
              <li key={i}>
                <img src={src} alt="" className="size-16 rounded border object-cover" data-testid="message-image" />
              </li>
            ))}
        </ul>
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

interface ComposerHandle {
  /** Attach images dropped on the conversation. */
  addImages: (files: File[]) => void;
}

/**
 * The input (plan 10.1). Idle: Enter sends. While the session runs, a message is added to the run right
 * away (steer) or after it (follow-up), and the run can be stopped. Images can be pasted, dropped or
 * picked as reference images when the selected model reads images (theme development design 4.2).
 */
function Composer({
  ref,
  project,
  session,
  uploader,
}: {
  ref: Ref<ComposerHandle>;
  project: ProjectInfo;
  session: SessionInfo;
  uploader: RefObject<MediaUploadHandle | null>;
}) {
  const { m, t, errorOf } = useI18n();
  const [text, setText] = useState(() => composerDraft(session.id));
  const [failed, setFailed] = useState<{ text: string; images: Attachment[] } | null>(null);
  const textRef = useRef(text);
  const [images, setImages] = useState<Attachment[]>(() => composerImages(session.id));
  // The box survives leaving the conversation (the view is keyed by session) until the message is sent.
  useEffect(() => saveComposer(session.id, text, images), [session.id, text, images]);
  const imagesRef = useRef(images);
  const [attachProblem, setAttachProblem] = useState<AttachProblem | "model" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const models = useQuery({ queryKey: keys.models, queryFn: api.models });
  const readsImages = selectedModelReadsImages(models.data);
  const running = session.status === "running";
  const theme = isThemeKey(project.key);
  const updateImages = (next: Attachment[]) => {
    imagesRef.current = next;
    setImages(next);
  };
  const addImages = async (files: File[]) => {
    if (files.length === 0) return;
    if (readsImages === false) {
      setAttachProblem("model");
      return;
    }
    const { added, problem } = await readAttachments(files, imagesRef.current.length);
    setAttachProblem(problem);
    if (added.length > 0) updateImages([...imagesRef.current, ...added].slice(0, MAX_REFERENCE_IMAGES));
  };
  useImperativeHandle(ref, () => ({ addImages: (files) => void addImages(files) }));
  // The message leaves the box at once and shows as waiting until the session takes it in (the events
  // remove it); on failure it comes back to the box, unless something new was typed meanwhile.
  const send = useMutation({
    mutationFn: (vars: {
      mode: "prompt" | "steer" | "followUp";
      text: string;
      images: Attachment[];
      pendingId: number;
    }) =>
      api.sendMessage(session.id, {
        text: vars.text,
        mode: vars.mode,
        ...(vars.images.length > 0 && { images: vars.images.map(({ mimeType, data }) => ({ mimeType, data })) }),
      }),
    onError: (_err, vars) => {
      liveStore.removePending(session.id, vars.pendingId);
      // With an empty box, put the message and its images back as before. If the user has typed or attached
      // something else, keep it and offer the failed message as a retry instead of overwriting it.
      if (textRef.current === "" && imagesRef.current.length === 0) {
        textRef.current = vars.text;
        setText(vars.text);
        updateImages(vars.images);
      } else {
        setFailed({ text: vars.text, images: vars.images });
      }
    },
  });
  const submit = (mode: "prompt" | "steer" | "followUp") => {
    if (text.trim() === "" || send.isPending) return;
    const pendingId = liveStore.addPending(session.id, text);
    textRef.current = "";
    setText("");
    const attached = imagesRef.current;
    updateImages([]);
    setAttachProblem(null);
    send.mutate({ mode, text, images: attached, pendingId });
  };
  const stop = useMutation({ mutationFn: () => api.abortSession(session.id) });
  const disabled = !!project.readOnly;
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
          onDrop={(e) => {
            // Images dropped on the input are attached; anything else goes on to the conversation's drop.
            const files = Array.from(e.dataTransfer.files);
            if (files.length === 0 || !files.every((f) => f.type.startsWith("image/"))) return;
            e.preventDefault();
            e.stopPropagation();
            void addImages(files);
          }}
        >
          {session.status === "queued" && <p className="text-xs text-amber-600 dark:text-amber-400">{m.chat.queued}</p>}
          {images.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label={t(m.chat.images, { count: images.length })}>
              {images.map((image) => (
                <li key={image.id} className="relative" data-testid="attached-image">
                  <img
                    src={imageUrl(image) ?? undefined}
                    alt={image.name}
                    className="size-14 rounded border object-cover"
                  />
                  <button
                    type="button"
                    className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={t(m.chat.attach.remove, { name: image.name })}
                    onClick={() => {
                      updateImages(imagesRef.current.filter((x) => x.id !== image.id));
                      setAttachProblem(null);
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {attachProblem && (
            <p role="alert" className="text-xs text-destructive" data-testid="attach-problem">
              {attachProblem === "model" ? m.chat.attach.modelUnsupported : m.chat.attach[attachProblem]}
            </p>
          )}
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
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
              if (files.length === 0) return;
              e.preventDefault();
              void addImages(files);
            }}
          />
          <div className="flex items-center gap-2">
            {(send.error || stop.error) && (
              <p role="alert" className="min-w-0 flex-1 text-xs text-destructive" data-testid="composer-error">
                {errorOf(send.error ?? stop.error)}
              </p>
            )}
            {failed && (
              <p className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1">{m.chat.sendFailed}</span>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  data-testid="restore-failed-message"
                  onClick={() => {
                    textRef.current = failed.text;
                    setText(failed.text);
                    updateImages(failed.images);
                    setFailed(null);
                  }}
                >
                  {m.common.retry}
                </Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => setFailed(null)}>
                  {m.common.cancel}
                </Button>
              </p>
            )}
            <div className="ml-auto flex items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                accept={ATTACH_ACCEPT}
                multiple
                hidden
                data-testid="attach-images-input"
                onChange={(e) => {
                  void addImages(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <span title={readsImages === false ? m.chat.attach.modelUnsupported : m.chat.attach.add}>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={m.chat.attach.add}
                  data-testid="attach-images"
                  disabled={readsImages === false || images.length >= MAX_REFERENCE_IMAGES}
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus />
                </Button>
              </span>
              {!theme && (
                <MediaUpload
                  ref={uploader}
                  siteId={project.key}
                  disabled={session.status !== "idle"}
                  disabledReason={m.media.busy}
                  trigger={<Paperclip />}
                  ariaLabel={m.media.upload}
                  size="icon-sm"
                  variant="ghost"
                  onUploaded={(result, file) => {
                    const line = t(m.media.uploadedLine, { name: file.name, url: result.url });
                    setText((current) => {
                      const next = current.trim() === "" ? line : `${current}\n${line}`;
                      textRef.current = next;
                      return next;
                    });
                  }}
                />
              )}
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
