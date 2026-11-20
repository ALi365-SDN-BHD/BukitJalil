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
  | { type: "error"; code: "port_in_use" | "home_in_use" | "start_failed"; message: string };

/** What the desktop app asks of the server. */
export type DesktopInbound =
  | { type: "login" }
  | { type: "shutdown" }
  /** Result of opening an installer; null means it opened. */
  | { type: "open-update-result"; id: number; error: string | null };

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
  const { type, id, error } = data as {
    type?: unknown;
    id?: unknown;
    error?: unknown;
  };
  if (type === "login" || type === "shutdown") return { type };
  if (type === "open-update-result" && typeof id === "number" && (error === null || typeof error === "string")) {
    return { type, id, error };
  }
  return null;
}

const openPending = new Map<number, (error: string | null) => void>();
const openListenerChannels = new WeakSet<DesktopChannel>();
let openSequence = 0;

/**
 * Ask the desktop app to open an installer and wait for the result. The main process returns the
 * `shell.openPath` error, so the UI does not claim success when nothing opened.
 */
export function requestOpenInstaller(
  channel: DesktopChannel,
  file: string,
  timeoutMs = 15_000,
): Promise<string | null> {
  if (!openListenerChannels.has(channel)) {
    openListenerChannels.add(channel);
    channel.onMessage((message) => {
      if (message.type !== "open-update-result") return;
      const finish = openPending.get(message.id);
      if (!finish) return;
      openPending.delete(message.id);
      finish(message.error);
    });
  }
  const id = ++openSequence;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      openPending.delete(id);
      resolve("timeout");
    }, timeoutMs);
    timer.unref?.();
    openPending.set(id, (error) => {
      clearTimeout(timer);
      resolve(error);
    });
    try {
      channel.send({ type: "open-update", id, path: file });
    } catch (err) {
      openPending.delete(id);
      clearTimeout(timer);
      resolve(err instanceof Error ? err.message : String(err));
    }
  });
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
