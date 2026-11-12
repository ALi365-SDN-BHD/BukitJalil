import type { SessionDetail, SessionInfo, SessionStatus } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { setComposerDraft } from "./drafts";
import { liveStore } from "./store";

export const sessionPath = (siteId: string, sessionId: string) => `/sites/${siteId}/sessions/${sessionId}`;

export function useSessions(siteId: string) {
  return useQuery({ queryKey: keys.sessions(siteId), queryFn: () => api.sessions(siteId) });
}

/** Create a session and open it. */
export function useCreateSession(siteId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    /** `draft`: text to put in the new conversation's input, for the user to read, change and send. */
    mutationFn: (_draft?: string) => api.createSession(siteId),
    onSuccess: (session, draft) => {
      if (draft) setComposerDraft(session.id, draft);
      queryClient.setQueryData<SessionInfo[]>(keys.sessions(siteId), (list) =>
        list ? [session, ...list.filter((s) => s.id !== session.id)] : [session],
      );
      navigate(sessionPath(siteId, session.id));
    },
  });
}

export function StatusDot({ status }: { status: SessionStatus }) {
  const { m } = useI18n();
  const tone =
    status === "running" ? "bg-sky-500 animate-pulse" : status === "queued" ? "bg-amber-500" : "bg-muted-foreground/40";
  return (
    <span
      role="img"
      className={`inline-block size-2 shrink-0 rounded-full ${tone}`}
      title={m.chat.status[status]}
      aria-label={m.chat.status[status]}
      data-status={status}
    />
  );
}

/** The open site's sessions in the sidebar (plan 10.1), most recently used first. */
export function SessionList({ siteId, readOnly }: { siteId: string; readOnly: boolean }) {
  const { m, errorOf } = useI18n();
  const { sessionId } = useParams();
  const sessions = useSessions(siteId);
  const create = useCreateSession(siteId);
  return (
    <div className="ml-3 flex flex-col gap-0.5 border-l py-1 pl-2" data-testid="session-list">
      {sessions.error && <p className="px-2 text-xs text-destructive">{errorOf(sessions.error)}</p>}
      {sessions.data?.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">{m.chat.noSessions}</p>}
      {sessions.data?.map((s) => (
        <SessionItem key={s.id} siteId={siteId} session={s} selected={sessionId === s.id} />
      ))}
      {!readOnly && (
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:opacity-50"
          data-testid="new-session"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus className="size-3" /> {m.chat.newSession}
        </button>
      )}
      {create.error && <p className="px-2 text-xs text-destructive">{errorOf(create.error)}</p>}
    </div>
  );
}

function SessionItem({ siteId, session, selected }: { siteId: string; session: SessionInfo; selected: boolean }) {
  const { m } = useI18n();
  return (
    <div className={`group flex items-center rounded-md ${selected ? "bg-accent" : "hover:bg-accent/60"}`}>
      <NavLink
        to={sessionPath(siteId, session.id)}
        data-testid="session-item"
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-sm ${selected ? "font-medium" : ""}`}
      >
        <StatusDot status={session.status} />
        <span className="min-w-0 flex-1 truncate">{session.title ?? m.chat.untitled}</span>
      </NavLink>
      <SessionMenu siteId={siteId} session={session} />
    </div>
  );
}

/** Manual rename lives in the session row's menu; automatic titles only fill an empty title. */
function SessionMenu({ siteId, session }: { siteId: string; session: SessionInfo }) {
  const { m, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState("");
  const rename = useMutation({
    mutationFn: (next: string | null) => api.renameSession(session.id, next),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.session(session.id), (d: SessionDetail | undefined) =>
        d ? { ...d, session: updated } : d,
      );
      void queryClient.invalidateQueries({ queryKey: keys.sessions(siteId) });
      setOpen(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteSession(session.id),
    onSuccess: () => {
      setConfirmDelete(false);
      liveStore.markDeleted(session.id);
      queryClient.setQueryData<SessionInfo[]>(keys.sessions(siteId), (list) =>
        list?.filter((item) => item.id !== session.id),
      );
      queryClient.removeQueries({ queryKey: keys.session(session.id) });
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    rename.mutate(title.trim() === "" ? null : title.trim());
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="mr-0.5 shrink-0 text-muted-foreground"
            aria-label={m.chat.more}
            title={m.chat.more}
            data-testid={`session-menu-${session.id}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setTitle(session.title ?? "");
              rename.reset();
              setOpen(true);
            }}
            data-testid="session-rename"
          >
            <Pencil /> {m.chat.rename}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => {
              remove.reset();
              setConfirmDelete(true);
            }}
            data-testid="session-delete"
          >
            <Trash2 /> {m.chat.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={m.common.close}>
          <DialogTitle>{m.chat.rename}</DialogTitle>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <label htmlFor={`session-title-${session.id}`} className="text-sm">
              {m.chat.renameLabel}
            </label>
            <Input
              id={`session-title-${session.id}`}
              value={title}
              maxLength={200}
              autoFocus
              data-testid="rename-input"
              onChange={(e) => setTitle(e.target.value)}
            />
            {rename.error && (
              <p role="alert" className="text-sm text-destructive">
                {errorOf(rename.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {m.common.cancel}
              </Button>
              <Button type="submit" disabled={rename.isPending} data-testid="rename-save">
                {rename.isPending ? m.common.saving : m.common.save}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent closeLabel={m.common.close}>
          <DialogTitle>{m.chat.deleteTitle}</DialogTitle>
          <DialogDescription>{m.chat.deleteBody}</DialogDescription>
          {remove.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorOf(remove.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {m.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              data-testid="delete-confirm"
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? m.chat.deleting : m.chat.delete}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
