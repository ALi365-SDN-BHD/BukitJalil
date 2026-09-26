import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
} from "electron";
import path from "node:path";
import * as fs from "node:fs/promises";
import { Workspace } from "./workspace";
import { scopedPath } from "./files";
import { textField } from "./project";

const appURL = "bukitjalil://app/index.html";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "bukitjalil",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.setName("BukitJalil");
if (process.env.BUKITJALIL_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.BUKITJALIL_DATA_DIR));

let window: BrowserWindow | null = null;
let workspace: Workspace | undefined;
let quitting = false;
let cleanupComplete = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (cleanupComplete || !workspace) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void workspace.dispose().finally(() => {
      cleanupComplete = true;
      app.quit();
    });
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => app.quit());
  void app
    .whenReady()
    .then(start)
    .catch((error) => {
      console.error(error);
      dialog.showErrorBox("BukitJalil 无法启动", String(error));
      app.quit();
    });
}

async function start() {
  const rendererRoot = await fs.realpath(path.join(__dirname, "renderer"));
  protocol.handle("bukitjalil", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== "app" || request.method !== "GET")
        return new Response(null, { status: 403 });
      const relative = decodeURIComponent(url.pathname).slice(1);
      if (relative !== "index.html" && !relative.startsWith("assets/"))
        return new Response(null, { status: 404 });
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      };
      const body = await fs.readFile(await scopedPath(rendererRoot, relative));
      return new Response(new Uint8Array(body), {
        headers: {
          "Content-Type":
            types[path.extname(relative)] ?? "application/octet-stream",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  await fs.mkdir(app.getPath("userData"), { recursive: true });
  workspace = new Workspace(
    await fs.realpath(app.getPath("userData")),
    (state) => {
      if (window && !window.isDestroyed())
        window.webContents.send("workspace:changed", state);
    },
  );
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on("will-download", (event) => event.preventDefault());
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const preview = workspace?.state().preview?.url;
    callback({
      cancel: !(
        details.url.startsWith("bukitjalil://app/") ||
        (preview && details.url.startsWith(preview))
      ),
    });
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith("http://127.0.0.1:")) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; sandbox",
          ],
          "X-Content-Type-Options": ["nosniff"],
        },
      });
    } else callback({});
  });
  window = new BrowserWindow({
    width: 1440,
    height: 930,
    minWidth: 1080,
    minHeight: 720,
    title: "BukitJalil",
    backgroundColor: "#eef2f4",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-frame-navigate", (event) => {
    const preview = workspace?.state().preview?.url;
    if (event.isMainFrame || !preview || !event.url.startsWith(preview))
      event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer exited:", details);
    app.quit();
  });
  window.on("closed", () => {
    window = null;
  });

  const handle = (channel: string, action: (value?: unknown) => unknown) =>
    ipcMain.handle(channel, (event, value) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== appURL
      )
        throw new Error("拒绝不受信任的 IPC 调用。");
      return action(value);
    });
  handle("workspace:state", () => workspace!.state());
  handle("workspace:create", async (value) => {
    const name = textField(value, 60);
    const result = await dialog.showSaveDialog(window!, {
      title: "为新项目选择一个新目录",
      buttonLabel: "创建项目",
      defaultPath: path.join(
        app.getPath("documents"),
        name.replace(/[/\\:]/g, "-"),
      ),
      properties: ["createDirectory"],
    });
    if (!result.canceled && result.filePath)
      await workspace!.create(result.filePath, name);
  });
  handle("workspace:open", async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: "打开 BukitJalil 项目目录",
      properties: ["openDirectory"],
    });
    if (!result.canceled) await workspace!.open(result.filePaths[0]);
  });
  handle("workspace:engine", async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: "选择本机 Bukit 可执行文件",
      properties: ["openFile"],
    });
    if (!result.canceled) await workspace!.chooseEngine(result.filePaths[0]);
  });
  handle("workspace:recent", (value) =>
    workspace!.openRecent(textField(value, 36)),
  );
  handle("workspace:theme", () => workspace!.applyTheme());
  handle("workspace:headline", (value) =>
    workspace!.editHeadline(textField(value, 120)),
  );
  handle("workspace:restore", (value) =>
    workspace!.restore(textField(value, 36)),
  );
  handle("workspace:build", () => workspace!.build());
  handle("workspace:cancel", () => workspace!.cancel());

  await workspace.initialize(process.env.BUKIT_BIN);
  await window.loadURL(appURL);
}
