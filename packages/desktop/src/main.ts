import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, Menu, session, shell } from "electron";
import { ServerProcess, type StartResult } from "./server.ts";

/** The desktop shell (plan M7): starts the server, opens it in a locked-down window, stops it on quit. */

const DEFAULT_PORT = 47880;

app.setName("BukitJalil");
// Tests run each app with its own profile, so they neither share the single-instance lock nor touch the
// user's own (~/Library/Application Support/BukitJalil).
if (process.env.BUKITJALIL_DESKTOP_PROFILE)
  app.setPath("userData", path.resolve(process.env.BUKITJALIL_DESKTOP_PROFILE));

const packaged = app.isPackaged;
const repoRoot = path.resolve(__dirname, "../../..");
// Packaged layout (plan M7 layer 4): Resources/app/{server.mjs, skills, templates, web}.
const resources = packaged ? path.join(process.resourcesPath, "app") : repoRoot;
const statusPage = path.join(__dirname, "status.html");
// Window and taskbar icon on Windows and Linux (macOS takes the app's .icns). Next to main.cjs in the
// package; from the sources while developing.
const windowIcon = path.join(__dirname, packaged ? "icon.png" : "../assets/icon.png");
const statusUrl = pathToFileURL(statusPage).href;
const dataDir = path.resolve(process.env.BUKITJALIL_HOME || path.join(os.homedir(), ".bukitjalil"));
const zh = () => app.getLocale().toLowerCase().startsWith("zh");

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
};

const server = new ServerProcess({
  // During development the server runs from its TypeScript sources (static/dev-server.mjs).
  entry: packaged ? path.join(resources, "server.mjs") : path.join(__dirname, "dev-server.mjs"),
  execArgv: [],
  cwd: packaged ? resources : path.join(repoRoot, "packages/server"),
  env: {
    ...process.env,
    ...(packaged ? { BUKITJALIL_RESOURCES: resources, BUKITJALIL_VERSION: app.getVersion() } : {}),
  },
  firstPort: Number(process.env.BUKITJALIL_DESKTOP_PORT) || DEFAULT_PORT,
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
  if (url) await win?.loadURL(url);
  else showError(text.failed(), "", server.output());
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
  ipcMain.handle("desktop:restart", async (event) => {
    if (!senderUrl(event).startsWith(statusUrl)) return;
    await open();
  });
}

function buildMenu() {
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
