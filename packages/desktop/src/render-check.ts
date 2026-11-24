import crypto from "node:crypto";
import { BrowserWindow, session } from "electron";
import { withDeadline } from "./deadline.ts";
import { type RenderPageResult, renderCheckPage } from "./render-check-page.ts";

/**
 * The render check of a theme project's preview (plan 14, borrowing from taste skill, D3): load each page of
 * a local preview in a hidden window that can reach nothing else, and run the page script at each width.
 */

export interface RenderCheckPage {
  url: string;
  results: RenderPageResult[];
}

const PAGE_TIMEOUT_MS = 30_000;
/**
 * The whole check, under the server's 3 minutes: a page script that hangs the renderer must not keep the
 * window, and `running`, forever.
 */
const CHECK_TIMEOUT_MS = 170_000;
const SETTLE_MS = 300;
const MAX_PER_RULE = 5;
export const MAX_RENDER_URLS = 6;
export const RENDER_WIDTHS = [320, 390, 768, 1280];

/** Only previews this app serves: http on 127.0.0.1 with a port. */
export function renderUrlAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port !== "";
  } catch {
    return false;
  }
}

let running = false;

export async function runRenderCheck(urls: string[], widths: number[]): Promise<RenderCheckPage[]> {
  if (running) throw new Error("a render check is already running");
  if (urls.length === 0 || urls.length > MAX_RENDER_URLS || !urls.every(renderUrlAllowed))
    throw new Error("the render check only opens up to six local preview pages");
  const origin = new URL(urls[0] as string).origin;
  if (!urls.every((u) => new URL(u).origin === origin)) throw new Error("the pages must come from one preview");
  const sizes = widths.filter((w) => Number.isInteger(w) && w >= 240 && w <= 1920).slice(0, 6);
  if (sizes.length === 0) throw new Error("no width to check");

  running = true;
  let win: BrowserWindow | null = null;
  try {
    return await withDeadline(
      check(urls, sizes, origin, (w) => {
        win = w;
      }),
      CHECK_TIMEOUT_MS,
      "the pages took longer than the check allows",
    );
  } finally {
    running = false;
    (win as BrowserWindow | null)?.destroy();
  }
}

async function check(
  urls: string[],
  sizes: number[],
  origin: string,
  opened: (win: BrowserWindow) => void,
): Promise<RenderCheckPage[]> {
  // An in-memory partition of its own: nothing is kept, and only the preview (and data: URLs) can load.
  const ses = session.fromPartition(`render-check-${crypto.randomBytes(12).toString("hex")}`);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", (event) => event.preventDefault());
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith("data:") || details.url.startsWith(`${origin}/`) || details.url === origin;
    callback({ cancel: !allowed });
  });
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    useContentSize: true,
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
  opened(win);
  const contents = win.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-prevent-unload", (event) => event.preventDefault());
  contents.on("will-navigate", (event, value) => {
    if (!value.startsWith(`${origin}/`)) event.preventDefault();
  });
  try {
    const pages: RenderCheckPage[] = [];
    for (const url of urls) {
      await withDeadline(win.loadURL(url), PAGE_TIMEOUT_MS, `${url} took longer than 30 seconds`);
      const results: RenderPageResult[] = [];
      for (const width of sizes) {
        win.setContentSize(width, 900);
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
        const code = `(${renderCheckPage.toString()})(${JSON.stringify({ maxPerRule: MAX_PER_RULE })})`;
        results.push((await contents.executeJavaScriptInIsolatedWorld(1002, [{ code }])) as RenderPageResult);
      }
      pages.push({ url, results });
    }
    return pages;
  } finally {
    void ses.clearStorageData().catch(() => {});
  }
}
