import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Duplex } from "node:stream";

/** Limits of one capture (theme development design 6.2). */
export const CAPTURE_LIMITS = {
  /** Requests for the whole capture, proxy and follow-up fetches included. */
  maxRequests: 500,
  /** Response bodies together. */
  maxTotalBytes: 30 * 1024 * 1024,
  /** One response body. */
  maxResourceBytes: 14 * 1024 * 1024,
  /** A request, a DNS lookup and a page load each. */
  timeoutMs: 30_000,
} as const;

export class CaptureNetworkError extends Error {
  constructor(
    readonly code: "blocked" | "too_large" | "too_many" | "timeout" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "CaptureNetworkError";
  }
}

/**
 * One budget for a whole capture: the proxy counts HTTP requests, the desktop window reports HTTPS ones
 * (the proxy cannot see inside a CONNECT tunnel), and both add the bytes they can see.
 */
export class CaptureBudget {
  requests = 0;
  bytes = 0;
  error: string | null = null;

  constructor(
    private readonly limits: { maxRequests: number; maxTotalBytes: number; maxResourceBytes: number } = CAPTURE_LIMITS,
  ) {}

  /** False (and an error) when the capture has used up its request budget. */
  addRequest(): boolean {
    if (this.error) return false;
    this.requests += 1;
    if (this.requests > this.limits.maxRequests) {
      this.error = `more than ${this.limits.maxRequests} requests`;
      return false;
    }
    return true;
  }

  /** False (and an error) when the bytes exceed the whole capture or one response. */
  addBytes(bytes: number): boolean {
    if (this.error) return false;
    if (bytes > this.limits.maxResourceBytes) {
      this.error = `a response is larger than ${this.limits.maxResourceBytes} bytes`;
      return false;
    }
    this.bytes += bytes;
    if (this.bytes > this.limits.maxTotalBytes) {
      this.error = `more than ${this.limits.maxTotalBytes} bytes`;
      return false;
    }
    return true;
  }

  fail(message: string): void {
    this.error ??= message;
  }
}

/** The declared length of a response, when the header is a plain non-negative integer. */
export function contentLength(headers: Record<string, string[] | undefined> | undefined): number | null {
  if (!headers) return null;
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "content-length");
  const value = key ? headers[key]?.[0] : undefined;
  if (value === undefined) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

/**
 * The URLs a capture may visit (design 6.2): http and https, no credentials, no other schemes. The user's
 * pages must share an origin; resources may be elsewhere but still go through the checks below.
 */
export function captureUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || !url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

/** `localhost` and names under it never need a DNS answer. */
export function isLocalName(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost");
}

/**
 * Whether an address is outside the public internet (design 6.2): loopback, private, link-local, multicast,
 * documentation, NAT64, Teredo and other special ranges. `testOrigin` allows only a literal 127.0.0.1/::1
 * for the desktop tests' local server; nothing else is ever allowed through it.
 */
export function blockedAddress(address: string, host = "", testOrigin = false): boolean {
  const ip = address.toLowerCase();
  if (testOrigin && (ip === "127.0.0.1" || ip === "::1") && (host === "127.0.0.1" || host === "::1" || host === ""))
    return false;
  const family = net.isIP(ip);
  if (family === 4) return blockedV4(ip);
  if (family === 6) return blockedV6(ip);
  return true;
}

function blockedV4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 2) ||
    (a === 192 && b === 88) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function blockedV6(ip: string): boolean {
  const groups = ipv6Groups(ip);
  if (!groups) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const zero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (zero && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true; // :: and ::1
  if (zero && g5 === 0xffff) return blockedV4(`${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`); // mapped
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return true; // link/site local
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0x0db8)) return true; // Teredo, documentation
  if (g0 === 0x0064 && g1 === 0xff9b) return true; // NAT64
  if (g0 === 0x2002) return true; // 6to4
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard-only
  return false;
}

/** Eight groups of an IPv6 address, with an IPv4 tail and `::` expanded; null when it is malformed. */
function ipv6Groups(ip: string): number[] | null {
  const [head, tail] = ip.includes("::") ? (ip.split("::") as [string, string]) : [ip, null];
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const piece of part.split(":")) {
      if (piece.includes(".")) {
        const v4 = piece.split(".").map(Number);
        if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        groups.push(((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0));
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
        groups.push(Number.parseInt(piece, 16));
      }
    }
    return groups;
  };
  const left = parse(head);
  if (!left) return null;
  if (tail === null) return left.length === 8 ? left : null;
  const right = parse(tail);
  if (!right || left.length + right.length > 8) return null;
  return [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
}

export interface Fetched {
  url: string;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/**
 * The only way a capture talks to the network (design 6.2): it resolves the name once, refuses addresses
 * outside the public internet, and then connects to exactly that address, so a second DNS answer cannot
 * redirect the request (DNS rebinding). The same class is the local HTTP proxy Chromium uses.
 */
export class CaptureNetwork {
  readonly budget: CaptureBudget;
  /** When the last proxied or checked request started or finished; the page loader waits for 2 s of quiet. */
  lastActivity = Date.now();
  private server: http.Server | null = null;

  constructor(
    private readonly limits = CAPTURE_LIMITS,
    private readonly testOrigin = false,
    budget?: CaptureBudget,
    /** A test-only CA for the local TLS fixture; production uses the system store. */
    private readonly ca?: string,
  ) {
    this.budget = budget ?? new CaptureBudget(limits);
  }

  /** Requests counted for this capture (HTTP here, HTTPS by the desktop window). */
  get requests(): number {
    return this.budget.requests;
  }

  /** Bytes counted for this capture. */
  get bytes(): number {
    return this.budget.bytes;
  }

  /** Remember that the page is still talking to the network. */
  touch(): void {
    this.lastActivity = Date.now();
  }

  /** The proxy's loopback port. */
  async listen(): Promise<number> {
    if (this.server) throw new Error("already listening");
    const server = http.createServer((req, res) => this.proxyRequest(req, res));
    server.on("connect", (req, socket, head) => this.proxyConnect(req, socket, head));
    server.on("clientError", (_err, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    this.server = server;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no proxy port");
    return address.port;
  }

  close(): void {
    this.server?.close();
    this.server = null;
  }

  /** A checked GET used for robots.txt, cross-origin styles and opted-in images and fonts. */
  async fetch(url: URL, maxBytes = this.limits.maxResourceBytes): Promise<Fetched> {
    let current = url;
    for (let redirects = 0; redirects < 5; redirects++) {
      const target = await this.target(current);
      const response = await this.request(current, target, maxBytes);
      this.touch();
      if (response.status < 300 || response.status >= 400) return { ...response, url: current.toString() };
      const location = response.headers.location;
      if (!location) return { ...response, url: current.toString() };
      const next = captureUrl(new URL(location, current).toString());
      if (!next) throw new CaptureNetworkError("blocked", "redirect to a scheme that is not http(s)");
      current = next;
    }
    throw new CaptureNetworkError("blocked", "too many redirects");
  }

  /** The checked address for a URL, or a CaptureNetworkError. `count` is false for a CONNECT the window counted. */
  async target(url: URL, count = true): Promise<{ address: string; family: 4 | 6 }> {
    if (count) this.count();
    this.touch();
    const host = url.hostname;
    if (isLocalName(host)) throw new CaptureNetworkError("blocked", "localhost and private addresses are not captured");
    if (net.isIP(host)) {
      if (blockedAddress(host, host, this.testOrigin))
        throw new CaptureNetworkError("blocked", `${host} is not a public address`);
      return { address: host, family: net.isIP(host) === 6 ? 6 : 4 };
    }
    let answers: { address: string; family: number }[];
    try {
      answers = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
      throw new CaptureNetworkError("failed", `cannot resolve ${host}`);
    }
    if (answers.length === 0) throw new CaptureNetworkError("failed", `cannot resolve ${host}`);
    // One private answer rejects the name: a rebinding host cannot hide by also answering publicly.
    for (const answer of answers)
      if (blockedAddress(answer.address, host, this.testOrigin))
        throw new CaptureNetworkError("blocked", `${host} resolves to a private address`);
    const first = answers[0] as { address: string; family: number };
    return { address: first.address, family: first.family === 6 ? 6 : 4 };
  }

  private count(): void {
    if (!this.budget.addRequest())
      throw new CaptureNetworkError("too_many", this.budget.error ?? "request limit reached");
  }

  private addBytes(n: number): void {
    if (!this.budget.addBytes(n)) throw new CaptureNetworkError("too_large", this.budget.error ?? "byte limit reached");
  }

  private request(
    url: URL,
    target: { address: string; family: 4 | 6 },
    maxBytes: number,
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const lib = url.protocol === "https:" ? https : http;
      const servername = net.isIP(url.hostname) === 0 ? url.hostname : undefined;
      const req = lib.request(
        {
          host: target.address,
          family: target.family,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: "GET",
          headers: { host: url.host, "user-agent": captureUserAgent(), accept: "*/*", "accept-encoding": "identity" },
          ...(url.protocol === "https:"
            ? { ...(servername ? { servername } : {}), rejectUnauthorized: true, ...(this.ca ? { ca: this.ca } : {}) }
            : {}),
          timeout: this.limits.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            try {
              if (size > maxBytes) throw new CaptureNetworkError("too_large", "a response is too large");
              this.addBytes(chunk.length);
            } catch (err) {
              res.destroy();
              reject(err);
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
          );
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new CaptureNetworkError("timeout", "the request timed out")));
      req.on("error", (err) =>
        reject(err instanceof CaptureNetworkError ? err : new CaptureNetworkError("failed", err.message)),
      );
      req.end();
    });
  }

  private async proxyRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (!req.url) throw new CaptureNetworkError("blocked", "no URL");
      const url = captureUrl(req.url);
      if (!url) throw new CaptureNetworkError("blocked", "not an http(s) URL");
      const target = await this.target(url);
      const lib = url.protocol === "https:" ? https : http;
      const servername = net.isIP(url.hostname) === 0 ? url.hostname : undefined;
      const upstream = lib.request(
        {
          host: target.address,
          family: target.family,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: req.method,
          headers: { ...req.headers, host: url.host },
          ...(url.protocol === "https:"
            ? { ...(servername ? { servername } : {}), rejectUnauthorized: true, ...(this.ca ? { ca: this.ca } : {}) }
            : {}),
          timeout: this.limits.timeoutMs,
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          let size = 0;
          upstreamRes.on("data", (chunk: Buffer) => {
            size += chunk.length;
            this.touch();
            try {
              if (size > this.limits.maxResourceBytes)
                throw new CaptureNetworkError("too_large", "a resource is too large");
              this.addBytes(chunk.length);
            } catch (err) {
              upstreamRes.destroy();
              res.destroy(err as Error);
              return;
            }
            res.write(chunk);
          });
          upstreamRes.on("end", () => {
            this.touch();
            res.end();
          });
          upstreamRes.on("error", () => res.destroy());
        },
      );
      upstream.on("timeout", () => upstream.destroy(new CaptureNetworkError("timeout", "the request timed out")));
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end("blocked by BukitJalil");
      });
      req.pipe(upstream);
    } catch {
      if (!res.headersSent) res.writeHead(403, { "content-type": "text/plain" });
      res.end("blocked by BukitJalil");
    }
  }

  private async proxyConnect(req: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const fail = () => {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
    };
    try {
      const text = req.url ?? "";
      const host = text.startsWith("[") ? text.slice(1, text.indexOf("]")) : text.split(":")[0];
      const port = Number(text.startsWith("[") ? text.slice(text.indexOf("]") + 2) : text.split(":")[1]);
      if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return fail();
      const target = await this.target(new URL(`https://${net.isIP(host) === 6 ? `[${host}]` : host}/`), false);
      this.touch();
      const upstream = net.connect({
        host: target.address,
        port,
        family: target.family,
        timeout: this.limits.timeoutMs,
      });
      upstream.once("connect", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on("timeout", () => {
        upstream.destroy();
        fail();
      });
      upstream.on("error", fail);
      socket.on("error", () => upstream.destroy());
    } catch {
      fail();
    }
  }
}

/** A generic desktop Chromium string, with nothing about the app or the user (design 6.2). */
export function captureUserAgent(): string {
  return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
}
