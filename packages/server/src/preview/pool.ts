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
  server: http.Server;
}

const MAX_PORT_ATTEMPTS = 200;

/**
 * One port per preview (plan 8.4): each slot (site × main/change) gets its own 127.0.0.1 port from
 * `base` upward, serves one build directory at "/", and checks Host against its own port.
 * Busy ports are skipped. Idle release arrives with real previews in M2.
 */
export class PreviewPool {
  private readonly slots = new Map<string, Slot>();
  /** Opens in flight, so two calls for one key share one server instead of leaking the first. */
  private readonly opening = new Map<string, Promise<{ port: number; url: string }>>();

  constructor(
    private readonly base: number,
    private readonly reserved: ReadonlySet<number>,
    private readonly logger: Logger,
  ) {}

  /** Open (or re-point) the slot `key` at `root`; returns its URL. */
  async open(key: string, root: string): Promise<{ port: number; url: string }> {
    const existing = this.slots.get(key);
    if (existing) {
      existing.root = root; // atomic switch to the new build
      return { port: existing.port, url: `http://127.0.0.1:${existing.port}/` };
    }
    const pending = this.opening.get(key);
    if (pending) {
      const opened = await pending;
      const slot = this.slots.get(key);
      if (slot) slot.root = root; // the later call wins, as with an existing slot
      return opened;
    }
    const opening = this.bind(key, root).finally(() => this.opening.delete(key));
    this.opening.set(key, opening);
    return opening;
  }

  private async bind(key: string, root: string): Promise<{ port: number; url: string }> {
    for (let port = this.base, attempts = 0; attempts < MAX_PORT_ATTEMPTS; port++) {
      if (this.reserved.has(port) || [...this.slots.values()].some((s) => s.port === port)) continue;
      attempts++;
      const slot: Slot = { key, port, root, server: http.createServer() };
      slot.server.on("request", (req, res) => this.handle(slot, req, res));
      const bound = await listen(slot.server, port);
      if (!bound) continue;
      this.slots.set(key, slot);
      this.logger.log("info", "preview.open", { key, port });
      return { port, url: `http://127.0.0.1:${port}/` };
    }
    throw new Error(`no free preview port from ${this.base}`);
  }

  async close(key: string): Promise<void> {
    const slot = this.slots.get(key);
    if (!slot) return;
    this.slots.delete(key);
    await new Promise<void>((resolve) => slot.server.close(() => resolve()));
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.slots.keys()].map((k) => this.close(k)));
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
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...previewHeaders, Allow: "GET, HEAD" }).end();
      return;
    }
    const resolved = resolveStaticFile(slot.root, req.url ?? "/");
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
    server.listen(port, "127.0.0.1");
  });
}
