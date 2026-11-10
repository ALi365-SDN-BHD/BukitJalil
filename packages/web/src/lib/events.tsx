import type { CurrentChange, ServerEvent, SessionDetail, SessionInfo } from "@bukitjalil/shared";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { liveStore } from "@/features/chat/store";
import { keys } from "./api";

export type Connection = "connecting" | "open" | "lost";

const RECONNECT_MS = 5000;

const ConnectionContext = createContext<Connection>("connecting");

/**
 * The tab's one event stream (plan 9.2). The browser reconnects by itself with Last-Event-ID; when the
 * server refuses (it restarted, so the login is gone, or it is down) the stream is opened again after a
 * while and everything is fetched anew, since events may have been missed.
 */
export function EventsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<Connection>("connecting");

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = (again: boolean) => {
      const s = new EventSource("/api/events");
      source = s;
      s.onopen = () => {
        setConnection("open");
        if (again) resync(queryClient);
      };
      s.onmessage = (e: MessageEvent<string>) => {
        try {
          handleEvent(queryClient, JSON.parse(e.data) as ServerEvent);
        } catch {
          // A malformed event is skipped; the next resync repairs whatever it would have changed.
        }
      };
      s.onerror = () => {
        if (s.readyState !== EventSource.CLOSED) {
          setConnection("connecting");
          return;
        }
        setConnection("lost");
        s.close();
        timer = setTimeout(() => open(true), RECONNECT_MS);
      };
    };
    open(false);
    return () => {
      clearTimeout(timer);
      source?.close();
    };
  }, [queryClient]);

  return <ConnectionContext.Provider value={connection}>{children}</ConnectionContext.Provider>;
}

export const useConnection = () => useContext(ConnectionContext);

function resync(queryClient: QueryClient): void {
  liveStore.reset();
  void queryClient.invalidateQueries();
}

/** Apply one event to the live store and to the cached queries it makes stale. */
export function handleEvent(queryClient: QueryClient, event: ServerEvent): void {
  if (event.type === "resync") {
    resync(queryClient);
    return;
  }
  liveStore.apply(event);
  switch (event.type) {
    case "session.status": {
      const { status } = event.data;
      const setStatus = (s: SessionInfo) => (s.id === event.sessionId ? { ...s, status } : s);
      queryClient.setQueryData<SessionInfo[]>(keys.sessions(event.siteId), (list) => list?.map(setStatus));
      queryClient.setQueryData<SessionDetail>(keys.session(event.sessionId), (d) =>
        d ? { ...d, session: setStatus(d.session) } : d,
      );
      if (status === "idle") {
        // The stored messages now include the run, with the entry ids a fork needs.
        void queryClient.invalidateQueries({ queryKey: keys.session(event.sessionId) });
        // A run touches updatedAt, which orders the list.
        void queryClient.invalidateQueries({ queryKey: keys.sessions(event.siteId) });
        // Nobody shows this session: what the run added is fetched when it is opened.
        const detail = queryClient.getQueryCache().find({ queryKey: keys.session(event.sessionId) });
        if (!detail?.getObserversCount()) liveStore.settle(event.sessionId);
      }
      break;
    }
    case "session.updated": {
      const { session } = event.data;
      queryClient.setQueryData<SessionInfo[]>(keys.sessions(event.siteId), (list) =>
        list ? [session, ...list.filter((s) => s.id !== session.id)] : list,
      );
      queryClient.setQueryData<SessionDetail>(keys.session(session.id), (d) => (d ? { ...d, session } : d));
      break;
    }
    case "session.deleted":
      queryClient.setQueryData<SessionInfo[]>(keys.sessions(event.siteId), (list) =>
        list?.filter((s) => s.id !== event.sessionId),
      );
      queryClient.removeQueries({ queryKey: keys.session(event.sessionId) });
      break;
    case "build.start":
      void queryClient.invalidateQueries({ queryKey: keys.builds(event.siteId) });
      break;
    case "build.end":
      void queryClient.invalidateQueries({ queryKey: keys.builds(event.siteId) });
      // A build can end before the list ever showed it running, so the preview cannot wait for that.
      void queryClient.invalidateQueries({ queryKey: ["preview", event.siteId] });
      break;
    case "change": {
      const { siteId } = event;
      const before = queryClient.getQueryData<CurrentChange>(keys.change(siteId))?.change;
      const after = event.data.change;
      queryClient.setQueryData<CurrentChange>(keys.change(siteId), event.data);
      const ofSite = (key: readonly unknown[]) => key[0] === "panel" && key[1] === siteId;
      if (after && before?.snapshotCommit !== after.snapshotCommit) {
        // Panels showing the change set's snapshot (ref=change) are out of date.
        void queryClient.invalidateQueries({ predicate: (q) => ofSite(q.queryKey) && q.queryKey[3] === "change" });
      } else if (before && !after) {
        // Closed: its snapshot can no longer be shown (the panels fall back to the main version), and when
        // it was applied the main version moved.
        queryClient.removeQueries({ predicate: (q) => ofSite(q.queryKey) && q.queryKey[3] === "change" });
        queryClient.removeQueries({ queryKey: ["preview", siteId, "change"] });
        void queryClient.invalidateQueries({ predicate: (q) => ofSite(q.queryKey) });
        void queryClient.invalidateQueries({ queryKey: keys.site(siteId) });
        void queryClient.invalidateQueries({ queryKey: keys.history(siteId) });
      }
      break;
    }
  }
}
