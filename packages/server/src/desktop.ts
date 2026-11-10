/**
 * The channel to the desktop app's main process (plan M7). Electron's utilityProcess gives the server
 * `process.parentPort`; a Node child started with an IPC channel (the tests) has `process.send`.
 */

/** What the server tells the desktop app. */
export type DesktopOutbound =
  | { type: "ready"; port: number }
  | { type: "login"; url: string }
  | { type: "error"; code: "port_in_use" | "home_in_use" | "start_failed"; message: string };

/** What the desktop app asks of the server. */
export type DesktopInbound = { type: "login" } | { type: "shutdown" };

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
  const type = (data as { type?: unknown }).type;
  return type === "login" || type === "shutdown" ? { type } : null;
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
