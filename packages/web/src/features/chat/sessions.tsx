import type { SessionInfo, SessionStatus } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";

export const sessionPath = (siteId: string, sessionId: string) => `/sites/${siteId}/sessions/${sessionId}`;

export function useSessions(siteId: string) {
  return useQuery({ queryKey: keys.sessions(siteId), queryFn: () => api.sessions(siteId) });
}

/** Create a session and open it. */
export function useCreateSession(siteId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api.createSession(siteId),
    onSuccess: (session) => {
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
  const sessions = useSessions(siteId);
  const create = useCreateSession(siteId);
  return (
    <div className="ml-3 flex flex-col gap-0.5 border-l py-1 pl-2" data-testid="session-list">
      {sessions.error && <p className="px-2 text-xs text-destructive">{errorOf(sessions.error)}</p>}
      {sessions.data?.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">{m.chat.noSessions}</p>}
      {sessions.data?.map((s) => (
        <NavLink
          key={s.id}
          to={sessionPath(siteId, s.id)}
          data-testid="session-item"
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-2 py-1 text-xs ${isActive ? "bg-accent font-medium" : "hover:bg-accent/60"}`
          }
        >
          <StatusDot status={s.status} />
          <span className="min-w-0 flex-1 truncate">{s.title ?? m.chat.untitled}</span>
        </NavLink>
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
