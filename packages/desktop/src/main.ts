import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, Menu, session, shell } from "electron";
import { CaptureService } from "./capture.ts";
import { runRenderCheck } from "./render-check.ts";
import { ServerProcess, type StartResult } from "./server.ts";
import { replaceAppImage } from "./update.ts";

/** The desktop shell (plan M7): starts the server, opens it in a locked-down window, stops it on quit. */

const DEFAULT_PORT = 47880;

app.setName("BukitJalil");
// QUIC is UDP and would bypass an HTTP proxy; the capture's checking proxy must see every request (design 6.2).
app.commandLine.appendSwitch("disable-quic");
// Tests run each app with its own profile, so they neither share the single-instance lock nor touch the
// user's own (~/Library/Application Support/BukitJalil).
if (process.env.BUKITJALIL_DESKTOP_PROFILE)
  app.setPath("userData", path.resolve(process.env.BUKITJALIL_DESKTOP_PROFILE));

const packaged = app.isPackaged;
const repoRoot = path.resolve(__dirname, "../../..");
// Packaged layout (plan M7 layer 4): Resources/app/{server.mjs, skills, web, bukit, theme-demo}.
const resources = packaged ? path.join(process.resourcesPath, "app") : repoRoot;
const statusPage = path.join(__dirname, "status.html");
// Window and taskbar icon on Windows and Linux (macOS takes the app's .icns). Next to main.cjs in the
// package; from the sources while developing.
const windowIcon = path.join(__dirname, packaged ? "icon.png" : "../assets/icon.png");
const statusUrl = pathToFileURL(statusPage).href;
const dataDir = path.resolve(process.env.BUKITJALIL_HOME || path.join(os.homedir(), ".bukitjalil"));
const updatesDir = path.join(dataDir, "updates");
const capturesDir = path.join(dataDir, "captures");
/** Root package.json while developing, the app bundle when packaged; BUKITJALIL_VERSION overrides for tests. */
const appVersion = process.env.BUKITJALIL_VERSION?.trim() || (packaged ? app.getVersion() : packageVersion());

function packageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : app.getVersion();
  } catch {
    return app.getVersion();
  }
}

/** Only files the server downloaded into the app's own updates folder may be opened. */
async function openUpdate(file: string): Promise<string | null> {
  try {
    // The native form: on Windows the JS one can differ in letter case or 8.3 spelling from the same folder.
    const root = fs.realpathSync.native(updatesDir);
    const target = fs.realpathSync.native(file);
    if (!target.startsWith(`${root}${path.sep}`) || !fs.statSync(target).isFile()) return "not an update file";
    if (process.platform === "linux" && process.env.APPIMAGE && target.endsWith(".AppImage")) {
      return await replaceAppImage(target, process.env.APPIMAGE, (appImage) => {
        app.relaunch({ execPath: appImage });
        app.quit();
      });
    }
    const error = await shell.openPath(target);
    // NSIS cannot replace files while this app is running; close after the installer has started.
    if (!error && process.platform === "win32") setTimeout(() => app.quit(), 500);
    return error || null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** The language the app's settings chose, reported by its page; until then the system's. Malay menus use English. */
let appLocale: "zh-CN" | "en" | "ms" | null = null;
const zh = () => (appLocale ?? app.getLocale()).toLowerCase().startsWith("zh");

const text = {
  starting: () => (zh() ? "正在启动 BukitJalil…" : "Starting BukitJalil…"),
  failed: () => (zh() ? "BukitJalil 无法启动" : "BukitJalil could not start"),
  stopped: () => (zh() ? "BukitJalil 的服务意外停止" : "BukitJalil's server stopped unexpectedly"),
  homeInUse: () =>
    zh()
      ? "另一个 BukitJalil 正在使用同一个数据目录（可能是在终端里用 pnpm start 启动的）。先关掉它，再点下面的按钮。"
      : "Another BukitJalil is using the same data directory (maybe one started with pnpm start in a terminal). Quit it, then press the button below.",
  portsInUse: () => (zh() ? "找不到可用的端口。" : "No free port was found."),
  noWeb: () =>
    zh()
      ? "还没有构建网页界面。在仓库目录运行 pnpm build，再点下面的按钮。"
      : "The web interface is not built yet. Run pnpm build in the repository, then press the button below.",
  logs: (dir: string) => (zh() ? `日志在 ${dir}` : `Logs are in ${dir}`),
  restart: () => (zh() ? "重新启动" : "Start again"),
  openLogs: () => (zh() ? "打开日志目录" : "Open Logs Folder"),
  openData: () => (zh() ? "打开数据目录" : "Open Data Folder"),
  // The slogan, as on the web app's welcome page (app.slogan / app.sloganSub).
  slogan: () =>
    zh() ? "每一次笔记，都值得被看见\n让 AI 帮你实现它" : "Every note deserves to be seen\nLet AI make it happen",
};

const server = new ServerProcess({
  // During development the server runs from its TypeScript sources (static/dev-server.mjs).
  entry: packaged ? path.join(resources, "server.mjs") : path.join(__dirname, "dev-server.mjs"),
  execArgv: [],
  cwd: packaged ? resources : path.join(repoRoot, "packages/server"),
  env: {
    ...process.env,
    ...(packaged ? { BUKITJALIL_RESOURCES: resources } : {}),
    BUKITJALIL_VERSION: appVersion,
  },
  firstPort: Number(process.env.BUKITJALIL_DESKTOP_PORT) || DEFAULT_PORT,
  onReset: () => void resetApp(),
  openUpdate,
  renderCheck: runRenderCheck,
});

let win: BrowserWindow | null = null;
let quitting = false;

function showStatus(query: Record<string, string>) {
  void win?.loadFile(statusPage, { query: { ...query, lang: zh() ? "zh-CN" : "en" } });
}

function showError(title: string, message: string, detail: string) {
  showStatus({
    title,
    text: `${message} ${text.logs(path.join(dataDir, "logs"))}`.trim(),
    detail,
    restart: text.restart(),
  });
}

function explain(result: Exclude<StartResult, { ok: true }>) {
  if (result.code === "home_in_use") return showError(text.failed(), text.homeInUse(), result.message);
  if (result.code === "port_in_use") return showError(text.failed(), text.portsInUse(), result.message);
  return showError(text.failed(), "", result.message || server.output());
}

/** Start the server if it is not running and open the app in the window. */
async function open() {
  if (!win) return;
  if (!server.running) {
    if (!packaged && !fs.existsSync(path.join(repoRoot, "packages/web/dist/index.html"))) {
      return showError(text.failed(), text.noWeb(), "");
    }
    showStatus({ title: text.starting(), text: text.starting() });
    const result = await server.start();
    if (!result.ok) return explain(result);
  }
  const url = await server.login();
  if (!url) return showError(text.failed(), "", server.output());
  await win?.loadURL(url);
}

/** Forgotten PIN (plan 6.9): the server asked to be started again with --reset, then the app opens anew. */
async function resetApp() {
  showStatus({ title: text.starting(), text: text.starting() });
  const result = await server.restartWithReset();
  if (!result.ok) return explain(result);
  await open();
}

server.onExit = (_code, tail) => {
  if (!quitting) showError(text.stopped(), "", tail);
};

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "BukitJalil",
    icon: windowIcon,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });
  void open();
}

/** The app's own pages: the server's origin and the local status page. */
function allowed(url: string): boolean {
  if (url.startsWith(statusUrl)) return true;
  try {
    return server.running && new URL(url).origin === server.origin;
  } catch {
    return false;
  }
}

/** Web links leave for the system browser; nothing else (file:, custom schemes) is opened. */
function openOutside(url: string) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "http:" || protocol === "https:") void shell.openExternal(url);
  } catch {
    // Not a URL.
  }
}

function senderUrl(event: IpcMainInvokeEvent): string {
  return event.senderFrame?.url ?? "";
}

const capture = new CaptureService({
  dir: capturesDir,
  // The desktop e2e tests' local site; never set in normal use (design 6.2 blocks private addresses).
  allowLoopback: process.env.BUKITJALIL_CAPTURE_ALLOW_LOOPBACK === "1",
  onProgress: (progress) => {
    if (win && server.running) win.webContents.send("desktop:capture-progress", progress);
  },
});

function lockDown() {
  // No camera, microphone, notifications, geolocation… for any page, the previews included.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event, url) => {
      if (allowed(url)) return;
      event.preventDefault();
      openOutside(url);
    });
    contents.setWindowOpenHandler(({ url }) => {
      openOutside(url);
      return { action: "deny" };
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
  ipcMain.handle("desktop:pick-folder", async (event, start: unknown) => {
    if (!server.running || !senderUrl(event).startsWith(`${server.origin}/`) || !win) return null;
    // Only where the dialog opens; the server checks the folder that comes back like any other path.
    const defaultPath = typeof start === "string" && path.isAbsolute(start) && start.length < 4096 ? start : undefined;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
      ...(defaultPath ? { defaultPath } : {}),
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("desktop:pick-file", async (event, start: unknown) => {
    if (!server.running || !senderUrl(event).startsWith(`${server.origin}/`) || !win) return null;
    const defaultPath = typeof start === "string" && path.isAbsolute(start) && start.length < 4096 ? start : undefined;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Zip", extensions: ["zip"] }],
      ...(defaultPath ? { defaultPath } : {}),
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("desktop:capture-preflight", async (event, urls: unknown) => {
    if (!server.running || !senderUrl(event).startsWith(`${server.origin}/`))
      return { ok: false, error: "not allowed" };
    const list = Array.isArray(urls) ? urls.filter((url): url is string => typeof url === "string") : [];
    return capture.preflight(list);
  });
  ipcMain.handle("desktop:capture-start", async (event, request: unknown) => {
    if (!server.running || !senderUrl(event).startsWith(`${server.origin}/`))
      return { ok: false, error: "not allowed" };
    const req = (request ?? {}) as Record<string, unknown>;
    const urls = Array.isArray(req.urls) ? req.urls.filter((url): url is string => typeof url === "string") : [];
    return capture.start({
      urls,
      images: req.images === true,
      fonts: req.fonts === true,
      authorized: req.authorized === true,
    });
  });
  // Saving a file the app produced (a theme zip): the user picks the path, the renderer sends the bytes.
  ipcMain.handle("desktop:save-file", async (event, name: unknown, data: unknown) => {
    if (!server.running || !senderUrl(event).startsWith(`${server.origin}/`) || !win) return null;
    if (typeof name !== "string" || !/^[^/\\\0]{1,200}$/.test(name)) return null;
    if (!(data instanceof ArrayBuffer) || data.byteLength > 64 * 1024 * 1024) return null;
    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath("downloads"), name),
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, Buffer.from(data));
    return result.filePath;
  });
  // The menus and the About panel follow the language chosen in the app's settings.
  ipcMain.on("desktop:locale", (event, locale: unknown) => {
    if (!server.running || !senderUrl(event).startsWith(`${server.origin}/`)) return;
    if ((locale !== "zh-CN" && locale !== "en" && locale !== "ms") || locale === appLocale) return;
    appLocale = locale;
    buildMenu();
  });
  ipcMain.handle("desktop:restart", async (event) => {
    if (!senderUrl(event).startsWith(statusUrl)) return;
    await open();
  });
}

function buildMenu() {
  // The About panel (app menu on macOS) shows the slogan under the name and version.
  app.setAboutPanelOptions({
    applicationName: "BukitJalil",
    applicationVersion: appVersion,
    credits: text.slogan(),
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : [{ role: "fileMenu" as const }]),
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          { label: text.openLogs(), click: () => void shell.openPath(path.join(dataDir, "logs")) },
          { label: text.openData(), click: () => void shell.openPath(dataDir) },
        ],
      },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on("window-all-closed", () => {
    // macOS apps stay open without windows; the Dock icon opens a new one.
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (!win) createWindow();
  });
  app.on("before-quit", (event) => {
    if (quitting || !server.running) return;
    event.preventDefault();
    quitting = true;
    void server.stop().finally(() => app.quit());
  });
  void app.whenReady().then(() => {
    // Run from the sources, the Dock would show Electron's own icon.
    if (!packaged) app.dock?.setIcon(windowIcon);
    lockDown();
    buildMenu();
    createWindow();
  });
}
