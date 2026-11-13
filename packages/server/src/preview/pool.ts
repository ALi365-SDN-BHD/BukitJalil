import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Logger } from "../log.ts";
import { previewHeaders } from "../security/headers.ts";
import { contentType, resolveStaticFile } from "../static-files.ts";

interface Slot {
  key: string;
  port: number;
  root: string;
  /** Where the base path redirects when the build has no index.html at its root (BuildReport.entry). */
  entry: string | undefined;
  /** The path the build is served under ("/" or "/a/b/", BuildReport.basePath); "/" redirects there. */
  basePath: string;
  server: http.Server;
  /** Last open or request, for the idle release. */
  usedAt: number;
}

const MAX_PORT_ATTEMPTS = 200;
/** A preview nobody opened or loaded for this long gives its port back (plan 8.4). */
export const PREVIEW_IDLE_MS = 30 * 60_000;
const SWEEP_MS = 60_000;

export class NoPreviewPortError extends Error {}

/** The address of a preview: its port and the path it is served under. */
export const previewUrl = (port: number, basePath = "/") => `http://127.0.0.1:${port}${basePath}`;

/**
 * One port per preview (plan 8.4): each slot (site × main/change) gets its own 127.0.0.1 port from
 * `base` upward, serves one build directory under its base path (plan 16 #8), and checks Host against
 * its own port.
 * Busy ports are skipped. A slot idle for `idleMs` is closed; opening it again picks a port anew.
 */
export class PreviewPool {
  private readonly slots = new Map<string, Slot>();
  /** Opens in flight, so two calls for one key share one server instead of leaking the first. */
  private readonly opening = new Map<string, Promise<{ port: number; url: string }>>();

  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly base: number,
    private readonly reserved: ReadonlySet<number>,
    private readonly logger: Logger,
    private readonly idleMs = PREVIEW_IDLE_MS,
  ) {}

  /** Slot key of a site's preview. */
  static key(siteId: string, ref: "main" | "change"): string {
    return `${siteId}:${ref}`;
  }

  /**
   * Open (or re-point) the slot `key` at `root`, served under `basePath` (checked by previewBasePath);
   * returns its URL.
   */
  async open(key: string, root: string, entry?: string, basePath = "/"): Promise<{ port: number; url: string }> {
    const existing = this.slots.get(key);
    if (existing) {
      // atomic switch to the new build
      Object.assign(existing, { root, entry, basePath, usedAt: Date.now() });
      return { port: existing.port, url: previewUrl(existing.port, basePath) };
    }
    const pending = this.opening.get(key);
    if (pending) {
      const opened = await pending;
      const slot = this.slots.get(key);
      // The later call wins, as with an existing slot.
      if (slot) Object.assign(slot, { root, entry, basePath });
      return { port: opened.port, url: previewUrl(opened.port, basePath) };
    }
    const opening = this.bind(key, root, entry, basePath).finally(() => this.opening.delete(key));
    this.opening.set(key, opening);
    return opening;
  }

  /** Point an open slot at a new build; false when the slot is not open (nothing is bound). */
  repoint(key: string, root: string, entry?: string, basePath = "/"): boolean {
    const slot = this.slots.get(key);
    if (!slot) return false;
    Object.assign(slot, { root, entry, basePath });
    return true;
  }

  /** The build directory an open slot serves. */
  rootOf(key: string): string | null {
    return this.slots.get(key)?.root ?? null;
  }

  /** Close the slots whose last use is older than the idle limit. */
  async sweep(now = Date.now()): Promise<void> {
    const idle = [...this.slots.values()].filter((s) => now - s.usedAt >= this.idleMs).map((s) => s.key);
    for (const key of idle) {
      this.logger.log("info", "preview.idle_close", { key });
      await this.close(key);
    }
  }

  private startSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_MS);
    this.sweeper.unref();
  }

  private async bind(
    key: string,
    root: string,
    entry: string | undefined,
    basePath: string,
  ): Promise<{ port: number; url: string }> {
    for (let port = this.base, attempts = 0; attempts < MAX_PORT_ATTEMPTS && port <= 65535; port++, attempts++) {
      if (this.reserved.has(port) || [...this.slots.values()].some((s) => s.port === port)) continue;
      const slot: Slot = { key, port, root, entry, basePath, server: http.createServer(), usedAt: Date.now() };
      slot.server.on("request", (req, res) => this.handle(slot, req, res));
      const bound = await listen(slot.server, port);
      if (!bound) continue;
      this.slots.set(key, slot);
      this.startSweeper();
      this.logger.log("info", "preview.open", { key, port });
      return { port, url: previewUrl(port, basePath) };
    }
    throw new NoPreviewPortError(`no free preview port from ${this.base}`);
  }

  /**
   * Stop serving `key`. A forced close (shutdown, site removal) also ends responses still being sent (a
   * paused video, a stalled reader), which `server.close` would wait for. The idle sweep only stops
   * listening and drops idle connections: a long download that outlived the idle limit finishes.
   */
  async close(key: string, opts: { force?: boolean } = {}): Promise<void> {
    const slot = this.slots.get(key);
    if (!slot) return;
    this.slots.delete(key);
    const closed = new Promise<void>((resolve) => slot.server.close(() => resolve()));
    if (!opts.force) {
      slot.server.closeIdleConnections();
      return;
    }
    slot.server.closeAllConnections();
    await closed;
  }

  async closeAll(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    await Promise.all([...this.slots.keys()].map((k) => this.close(k, { force: true })));
  }

  /** Close every slot of a site (it was removed). */
  async closeSite(siteId: string): Promise<void> {
    await Promise.all(
      [...this.slots.keys()].filter((k) => k.startsWith(`${siteId}:`)).map((k) => this.close(k, { force: true })),
    );
  }

  list(): { key: string; port: number }[] {
    return [...this.slots.values()].map(({ key, port }) => ({ key, port }));
  }

  private handle(slot: Slot, req: http.IncomingMessage, res: http.ServerResponse) {
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${slot.port}` && host !== `localhost:${slot.port}`) {
      res.writeHead(421, previewHeaders).end();
      return;
    }
    // Only requests the preview accepts count as use; rejected probes must not keep the port bound.
    slot.usedAt = Date.now();
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...previewHeaders, Allow: "GET, HEAD" }).end();
      return;
    }
    const url = req.url ?? "/";
    const query = url.indexOf("?");
    const pathname = query === -1 ? url : url.slice(0, query);
    const { basePath } = slot;
    // The build's links all start with the base path; "/" (and the base path without its slash) lead there.
    if (basePath !== "/" && (pathname === "/" || pathname === basePath.slice(0, -1))) {
      res.writeHead(302, { ...previewHeaders, Location: basePath }).end();
      return;
    }
    if (!pathname.startsWith(basePath)) {
      res.writeHead(404, previewHeaders).end();
      return;
    }
    const rel = `/${url.slice(basePath.length)}`;
    if (slot.entry && pathname === basePath) {
      res.writeHead(302, { ...previewHeaders, Location: `${basePath}${slot.entry.slice(1)}` }).end();
      return;
    }
    const resolved = resolveStaticFile(slot.root, rel);
    if (!resolved.ok) {
      res.writeHead(resolved.status, previewHeaders).end();
      return;
    }
    res.writeHead(200, { ...previewHeaders, "Content-Type": contentType(resolved.file) });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(resolved.file)
      .on("error", () => res.destroy())
      .pipe(res);
  }
}

function listen(server: http.Server, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // Any bind error (EADDRINUSE, EACCES, ...) means "try the next port".
    const onError = () => {
      server.off("listening", onListening);
      resolve(false);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port === port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    try {
      server.listen(port, "127.0.0.1");
    } catch {
      // A port outside 1..65535 throws synchronously; the pool tries the next one or gives up.
      resolve(false);
    }
  });
}
