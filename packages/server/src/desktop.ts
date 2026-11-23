/**
 * The channel to the desktop app's main process (plan M7). Electron's utilityProcess gives the server
 * `process.parentPort`; a Node child started with an IPC channel (the tests) has `process.send`.
 */

/** What the server tells the desktop app. */
export type DesktopOutbound =
  | { type: "ready"; port: number }
  | { type: "login"; url: string }
  /** Forgotten PIN (plan 6.9): stop this server and start it again with --reset. */
  | { type: "reset" }
  /** Open a downloaded installer with the desktop app (the app checks the path is inside its data directory). */
  | { type: "open-update"; id: number; path: string }
  /** Render a theme project's preview pages in a hidden window and check them (plan 14, taste skill D3). */
  | { type: "render-check"; id: number; urls: string[]; widths: number[] }
  | { type: "error"; code: "port_in_use" | "home_in_use" | "start_failed"; message: string };

/** What the desktop app asks of the server. */
export type DesktopInbound =
  | { type: "login" }
  | { type: "shutdown" }
  /** Result of opening an installer; null means it opened. */
  | { type: "open-update-result"; id: number; error: string | null }
  /** The render check's pages (checked by the caller), or the error that stopped it. */
  | { type: "render-check-result"; id: number; pages: unknown; error: string | null };

export interface DesktopChannel {
  send(message: DesktopOutbound): void;
  onMessage(handler: (message: DesktopInbound) => void): void;
  /** The desktop app went away without asking (Electron ends a utility process itself). */
  onClose(handler: () => void): void;
}

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
}

function inbound(data: unknown): DesktopInbound | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, id, error, pages } = data as {
    type?: unknown;
    id?: unknown;
    error?: unknown;
    pages?: unknown;
  };
  if (type === "login" || type === "shutdown") return { type };
  if (type === "open-update-result" && typeof id === "number" && (error === null || typeof error === "string")) {
    return { type, id, error };
  }
  if (type === "render-check-result" && typeof id === "number" && (error === null || typeof error === "string")) {
    return { type, id, pages: pages ?? null, error };
  }
  return null;
}

type Reply = Extract<DesktopInbound, { id: number }>;
const pending = new Map<number, (reply: Reply) => void>();
const listening = new WeakSet<DesktopChannel>();
let sequence = 0;

/**
 * Send `message` with a new id and wait for the reply with that id, or resolve `onTimeout()` (also when
 * sending fails, with the error) after `timeoutMs`.
 */
function request<T>(
  channel: DesktopChannel,
  message: (id: number) => DesktopOutbound,
  onReply: (reply: Reply) => T,
  onFail: (reason: string) => T,
  timeoutMs: number,
): Promise<T> {
  if (!listening.has(channel)) {
    listening.add(channel);
    channel.onMessage((reply) => {
      if (!("id" in reply)) return;
      const finish = pending.get(reply.id);
      if (!finish) return;
      pending.delete(reply.id);
      finish(reply);
    });
  }
  const id = ++sequence;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(onFail("timeout"));
    }, timeoutMs);
    timer.unref?.();
    pending.set(id, (reply) => {
      clearTimeout(timer);
      resolve(onReply(reply));
    });
    try {
      channel.send(message(id));
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      resolve(onFail(err instanceof Error ? err.message : String(err)));
    }
  });
}

/**
 * Ask the desktop app to open an installer and wait for the result. The main process returns the
 * `shell.openPath` error, so the UI does not claim success when nothing opened.
 */
export function requestOpenInstaller(
  channel: DesktopChannel,
  file: string,
  timeoutMs = 15_000,
): Promise<string | null> {
  return request(
    channel,
    (id) => ({ type: "open-update", id, path: file }),
    (reply) => (reply.type === "open-update-result" ? reply.error : "unexpected reply"),
    (reason) => reason,
    timeoutMs,
  );
}

/** Ask the desktop app to render and check preview pages: the pages it returned, or the error. */
export function requestRenderCheck(
  channel: DesktopChannel,
  urls: string[],
  widths: number[],
  timeoutMs = 180_000,
): Promise<{ pages: unknown; error: string | null }> {
  return request(
    channel,
    (id) => ({ type: "render-check", id, urls, widths }),
    (reply) =>
      reply.type === "render-check-result"
        ? { pages: reply.pages, error: reply.error }
        : { pages: null, error: "unexpected reply" },
    (reason) => ({ pages: null, error: reason }),
    timeoutMs,
  );
}

/** The channel, or null when nothing started this process with one. */
export function desktopChannel(proc: NodeJS.Process = process): DesktopChannel | null {
  const port = (proc as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
  if (port) {
    return {
      send: (message) => port.postMessage(message),
      onMessage: (handler) =>
        port.on("message", (event) => {
          const message = inbound(event.data);
          if (message) handler(message);
        }),
      onClose: () => {},
    };
  }
  if (typeof proc.send === "function") {
    const send = proc.send.bind(proc);
    return {
      send: (message) => {
        send(message);
      },
      onMessage: (handler) =>
        proc.on("message", (data) => {
          const message = inbound(data);
          if (message) handler(message);
        }),
      onClose: (handler) => proc.once("disconnect", handler),
    };
  }
  return null;
}
