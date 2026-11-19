import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, session, type WebContents } from "electron";
import {
  CAPTURE_LIMITS,
  CaptureNetwork,
  CaptureNetworkError,
  captureUrl,
  captureUserAgent,
  isLocalName,
} from "./capture-network.ts";
import { parseRobots, robotsAllows } from "./robots.ts";

/** The capture IPC contract, mirrored in packages/web/src/lib/desktop.ts. */
export interface CaptureRequest {
  urls: string[];
  /** Download images / font files into the capture (design 6.1); off means placeholders later. */
  images: boolean;
  fonts: boolean;
  /** The user confirmed the site is theirs or they are allowed to copy it. */
  authorized: boolean;
}

export interface CapturePageInfo {
  url: string;
  title: string;
}

export interface CapturePreflight {
  origin: string;
  /** The site is served over plain http: the UI warns that it can be altered on the way. */
  http: boolean;
  pages: { url: string; robotsAllowed: boolean }[];
}

export interface CaptureResult {
  captureId: string;
  title: string;
  pages: CapturePageInfo[];
  files: number;
  bytes: number;
}

export interface CaptureProgress {
  phase: "page" | "collect" | "screenshots" | "assets";
  url: string;
  index: number;
  total: number;
}

type Outcome<T> = { ok: true; result: T } | { ok: false; error: string };

/** Screenshot widths (design 6.2) and the tallest page captured in one image. */
const WIDTHS = [375, 768, 1280] as const;
const MAX_SCREENSHOT_HEIGHT = 8000;
const ROBOTS_MAX_BYTES = 512 * 1024;
const MAX_URLS = 5;

/**
 * The capture half of "clone a site" (theme development design 6): a hidden, locked-down BrowserWindow
 * renders the user's pages through a checking proxy, and the result (DOM, CSS, screenshots, optionally
 * images and fonts) is written to captures/<id>/ with a manifest. Converting it is the AI's job; the server
 * validates this directory again before it becomes a theme project.
 */
export class CaptureService {
  private running = false;

  constructor(
    private readonly opts: {
      /** <app data>/captures. */
      dir: string;
      /** The desktop tests' local server may use a literal loopback address. */
      allowLoopback: boolean;
      onProgress: (progress: CaptureProgress) => void;
    },
  ) {}

  /** The page list, same-origin and robots.txt check (design 6.1): read-only, nothing is written. */
  async preflight(urls: string[]): Promise<Outcome<CapturePreflight>> {
    try {
      const parsed = pageUrls(urls);
      const origin = parsed[0]?.origin ?? "";
      const network = new CaptureNetwork(CAPTURE_LIMITS, this.opts.allowLoopback);
      try {
        const robots = await readRobots(network, origin);
        return {
          ok: true,
          result: {
            origin,
            http: parsed[0]?.protocol === "http:",
            pages: parsed.map((url) => ({
              url: url.toString(),
              robotsAllowed: robotsAllows(robots, `${url.pathname}${url.search}`),
            })),
          },
        };
      } finally {
        network.close();
      }
    } catch (err) {
      return { ok: false, error: messageOf(err) };
    }
  }

  /** Capture the pages; the caller must have shown the authorization and robots results first. */
  async start(req: CaptureRequest): Promise<Outcome<CaptureResult>> {
    if (this.running) return { ok: false, error: "a capture is already running" };
    if (!req.authorized) return { ok: false, error: "the site must be confirmed as your own" };
    this.running = true;
    try {
      const urls = pageUrls(req.urls);
      const origin = urls[0]?.origin ?? "";
      const id = crypto.randomBytes(16).toString("hex");
      const dir = path.join(this.opts.dir, id);
      const network = new CaptureNetwork(CAPTURE_LIMITS, this.opts.allowLoopback);
      const partition = `capture-${crypto.randomBytes(12).toString("hex")}`;
      const ses = session.fromPartition(partition);
      let win: BrowserWindow | null = null;
      try {
        const port = await network.listen();
        await ses.setProxy({
          mode: "fixed_servers",
          proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
          // Never bypass the proxy for loopback: a page must not reach this machine directly.
          proxyBypassRules: "<-loopback>",
        });
        ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
        ses.setPermissionCheckHandler(() => false);
        ses.on("will-download", (event) => event.preventDefault());
        ses.webRequest.onBeforeRequest((details, callback) => {
          callback({ cancel: !requestAllowed(details.url) });
        });
        // Network idle includes finished HTTPS requests, which the HTTP proxy cannot see inside CONNECT.
        ses.webRequest.onCompleted(() => network.touch());
        ses.webRequest.onErrorOccurred(() => network.touch());
        win = new BrowserWindow({
          show: false,
          width: 1280,
          height: 900,
          skipTaskbar: true,
          paintWhenInitiallyHidden: true,
          webPreferences: {
            session: ses,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            webviewTag: false,
            disableDialogs: true,
            backgroundThrottling: false,
            spellcheck: false,
            devTools: false,
          },
        });
        const contents = win.webContents;
        contents.setUserAgent(captureUserAgent());
        // WebRTC must not make UDP connections outside the proxy (design 6.2: every request is checked).
        contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
        contents.setWindowOpenHandler(() => ({ action: "deny" }));
        contents.on("will-attach-webview", (event) => event.preventDefault());
        contents.on("will-prevent-unload", (event) => event.preventDefault());
        const sameOrigin = (value: string) => {
          try {
            return new URL(value).origin === origin;
          } catch {
            return false;
          }
        };
        contents.on("will-navigate", (event, value) => {
          if (!sameOrigin(value)) event.preventDefault();
        });
        contents.on("will-redirect", (event, value) => {
          if (!sameOrigin(value)) event.preventDefault();
        });

        fs.mkdirSync(path.join(dir, "pages"), { recursive: true, mode: 0o700 });
        fs.mkdirSync(path.join(dir, "reference"), { recursive: true, mode: 0o700 });

        const manifestPages: Record<string, unknown>[] = [];
        const reference: string[] = [];
        const assets: { path: string; source: string }[] = [];
        let title = "";
        for (const [index, url] of urls.entries()) {
          this.opts.onProgress({ phase: "page", url: url.toString(), index, total: urls.length });
          await this.load(win, network, url, origin, index);
          this.opts.onProgress({ phase: "collect", url: url.toString(), index, total: urls.length });
          const collected = await collect(contents);
          if (!title) title = collected.title || url.hostname;
          const css = [collected.css, ...(await this.externalCss(network, collected.sheetUrls))].join("\n");
          const pageDir = path.join(dir, "pages", String(index + 1));
          fs.mkdirSync(pageDir, { recursive: true, mode: 0o700 });
          fs.writeFileSync(path.join(pageDir, "index.html"), collected.dom);
          fs.writeFileSync(path.join(pageDir, "styles.css"), css);
          const meta = {
            url: url.toString(),
            title: collected.title,
            images: collected.images,
            resources: collected.resources,
          };
          fs.writeFileSync(path.join(pageDir, "meta.json"), JSON.stringify(meta, null, 2));

          this.opts.onProgress({ phase: "screenshots", url: url.toString(), index, total: urls.length });
          const shots: string[] = [];
          for (const width of WIDTHS) {
            const name = `${index + 1}-${width}.png`;
            const file = path.join(dir, "reference", name);
            await screenshot(win, contents, width, collected.height, file);
            shots.push(`reference/${name}`);
            reference.push(`reference/${name}`);
          }

          this.opts.onProgress({ phase: "assets", url: url.toString(), index, total: urls.length });
          if (req.images) await this.downloadImages(network, pageDir, collected.images, assets);
          if (req.fonts) await this.downloadFonts(network, pageDir, collected.resources, assets);

          manifestPages.push({
            url: url.toString(),
            title: collected.title,
            html: `pages/${index + 1}/index.html`,
            css: `pages/${index + 1}/styles.css`,
            meta: `pages/${index + 1}/meta.json`,
            screenshots: shots,
          });
        }

        const manifest = {
          format: 1,
          id,
          origin,
          title,
          options: { images: req.images, fonts: req.fonts },
          pages: manifestPages,
          reference,
          assets,
        };
        fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
        let files = 0;
        let bytes = 0;
        for (const entry of walk(dir)) {
          files += 1;
          bytes += fs.statSync(entry).size;
        }
        return {
          ok: true,
          result: {
            captureId: id,
            title,
            pages: manifestPages.map((p) => ({ url: String(p.url), title: String(p.title) })),
            files,
            bytes,
          },
        };
      } catch (err) {
        fs.rmSync(dir, { recursive: true, force: true });
        return { ok: false, error: messageOf(err) };
      } finally {
        win?.destroy();
        network.close();
        await ses.clearStorageData().catch(() => {});
        await ses.clearCache().catch(() => {});
      }
    } finally {
      this.running = false;
    }
  }

  /** Load one page and wait for it to settle; a redirect off the origin is refused by the listeners. */
  private async load(win: BrowserWindow, network: CaptureNetwork, url: URL, origin: string, index: number) {
    const started = Date.now();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`page ${index + 1} took longer than 30 seconds`)), CAPTURE_LIMITS.timeoutMs),
    );
    await Promise.race([win.loadURL(url.toString()), timeout]);
    if (new URL(win.webContents.getURL()).origin !== origin) throw new Error("the page went to another site");
    // Network idle: no new requests for 2 seconds (design 6.2), still bounded by the page timeout.
    for (;;) {
      if (Date.now() - network.lastActivity >= 2000) return;
      if (Date.now() - started > CAPTURE_LIMITS.timeoutMs) throw new Error(`page ${index + 1} did not settle`);
      await sleep(200);
    }
  }

  private async externalCss(network: CaptureNetwork, urls: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const href of [...new Set(urls)]) {
      try {
        const url = captureUrl(href);
        if (!url) continue;
        const response = await network.fetch(url, CAPTURE_LIMITS.maxResourceBytes);
        if (response.status === 200) out.push(response.body.toString("utf8"));
      } catch {
        // A stylesheet that cannot be read is simply missing; the pages themselves still import it.
      }
    }
    return out;
  }

  private async downloadImages(
    network: CaptureNetwork,
    pageDir: string,
    images: { src: string; width: number; height: number }[],
    assets: { path: string; source: string }[],
  ): Promise<void> {
    for (const [index, image] of images.entries()) {
      try {
        const url = captureUrl(image.src);
        if (!url) continue;
        const response = await network.fetch(url);
        const type = imageType(response.body);
        if (!type) continue;
        const name = `${path.basename(pageDir)}-${index}.${type}`;
        fs.writeFileSync(path.join(pageDir, name), response.body);
        assets.push({ path: `pages/${path.basename(pageDir)}/${name}`, source: url.toString() });
      } catch {
        // Skipped: the manifest still has the address and size for a placeholder.
      }
    }
  }

  private async downloadFonts(
    network: CaptureNetwork,
    pageDir: string,
    resources: { url: string; type: string }[],
    assets: { path: string; source: string }[],
  ): Promise<void> {
    const fonts = resources.filter((r) => /\.(woff2?|ttf|otf)(?:[?#]|$)/i.test(r.url));
    for (const [index, font] of fonts.entries()) {
      try {
        const url = captureUrl(font.url);
        if (!url) continue;
        const response = await network.fetch(url);
        const ext = /\.woff2(?:[?#]|$)/i.test(font.url)
          ? "woff2"
          : /\.woff(?:[?#]|$)/i.test(font.url)
            ? "woff"
            : /\.ttf(?:[?#]|$)/i.test(font.url)
              ? "ttf"
              : "otf";
        const name = `font-${path.basename(pageDir)}-${index}.${ext}`;
        fs.writeFileSync(path.join(pageDir, name), response.body);
        assets.push({ path: `pages/${path.basename(pageDir)}/${name}`, source: url.toString() });
      } catch {
        // Skipped: the theme uses a system or open-source font instead.
      }
    }
  }
}

/** The URLs of one capture: 1–5, valid http(s), all the same origin (design 6.1). */
function pageUrls(values: string[]): URL[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_URLS)
    throw new Error("give a homepage and up to four more pages");
  const urls = values.map((value) => captureUrl(value));
  if (urls.some((url) => url === null)) throw new Error("only http and https addresses are captured");
  const list = urls as URL[];
  const origin = list[0]?.origin;
  if (list.some((url) => url.origin !== origin)) throw new Error("all pages must be on the same site");
  return list;
}

/** Only http(s), data, blob and about:blank reach the capture window; websockets are refused. */
function requestAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "data:" || url.protocol === "blob:" || value === "about:blank") return true;
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (isLocalName(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

async function readRobots(network: CaptureNetwork, origin: string) {
  const response = await network.fetch(new URL("/robots.txt", origin), ROBOTS_MAX_BYTES);
  return response.status === 200 ? parseRobots(response.body.toString("utf8")) : [];
}

interface Collected {
  dom: string;
  css: string;
  sheetUrls: string[];
  title: string;
  height: number;
  images: { src: string; width: number; height: number }[];
  resources: { url: string; type: string }[];
}

/** Read the page in an isolated world, so page scripts cannot change what is collected (design 6.2). */
async function collect(contents: WebContents): Promise<Collected> {
  const code = `(() => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("script,noscript,iframe,object,embed").forEach((n) => n.remove());
    for (const el of clone.querySelectorAll("*")) {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on") || name === "action" || name === "srcdoc") el.removeAttribute(attr.name);
      }
    }
    const rules = [];
    const sheetUrls = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) rules.push(rule.cssText);
      } catch {
        if (sheet.href) sheetUrls.push(sheet.href);
      }
    }
    return JSON.stringify({
      dom: clone.outerHTML,
      css: rules.join("\\n"),
      sheetUrls,
      title: document.title,
      height: document.documentElement.scrollHeight,
      images: [...document.images].map((img) => ({
        src: img.currentSrc || img.src,
        width: img.naturalWidth,
        height: img.naturalHeight,
      })),
      resources: performance.getEntriesByType("resource").map((e) => ({ url: e.name, type: e.initiatorType })),
    });
  })()`;
  const raw = await contents.executeJavaScriptInIsolatedWorld(1001, [{ code }]);
  const parsed = JSON.parse(String(raw)) as Collected;
  return {
    ...parsed,
    height: Number.isFinite(parsed.height) ? parsed.height : 900,
    images: Array.isArray(parsed.images) ? parsed.images : [],
    resources: Array.isArray(parsed.resources) ? parsed.resources : [],
  };
}

/** One full-page screenshot per width, capped at a height Chromium can render in one piece. */
async function screenshot(
  win: BrowserWindow,
  contents: WebContents,
  width: number,
  pageHeight: number,
  file: string,
): Promise<void> {
  win.setContentSize(width, 900);
  await sleep(300);
  const measured = Number(
    await contents.executeJavaScriptInIsolatedWorld(1001, [{ code: "document.documentElement.scrollHeight" }]),
  );
  // shortcut: a page taller than 8000 px is captured from the top only; stitch segments if users need the rest.
  const height = Math.min(MAX_SCREENSHOT_HEIGHT, Math.max(600, measured || pageHeight));
  win.setContentSize(width, height);
  await sleep(300);
  const image = await contents.capturePage();
  const size = image.getSize();
  if (size.width === 0 || size.height === 0) throw new Error("the screenshot is empty");
  fs.writeFileSync(file, image.toPNG());
}

function imageType(data: Buffer): "png" | "jpg" | "webp" | "gif" | "svg" | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "webp";
  if (data.length >= 6 && data.subarray(0, 6).toString("ascii") === "GIF89a") return "gif";
  if (data.subarray(0, 512).toString("utf8").trimStart().startsWith("<svg")) return "svg";
  return null;
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function messageOf(err: unknown): string {
  if (err instanceof CaptureNetworkError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
