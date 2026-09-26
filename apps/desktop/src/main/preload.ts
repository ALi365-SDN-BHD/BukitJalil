import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI, State, ChatState } from "../shared";

const api: DesktopAPI = {
  chatState: () => ipcRenderer.invoke("chat:state"),
  connectChat: () => ipcRenderer.invoke("chat:connect"),
  saveCodexPath: (path) => ipcRenderer.invoke("chat:binary", path),
  saveModel: (value) => ipcRenderer.invoke("chat:model", value),
  loginChat: () => ipcRenderer.invoke("chat:login"),
  cancelLoginChat: () => ipcRenderer.invoke("chat:cancel-login"),
  sendChat: (value) => ipcRenderer.invoke("chat:send", value),
  cancelChat: (projectPath) => ipcRenderer.invoke("chat:cancel", projectPath),
  subscribeChat: (listener) => {
    const receive = (_event: unknown, state: ChatState) => listener(state);
    ipcRenderer.on("chat:changed", receive);
    return () => ipcRenderer.removeListener("chat:changed", receive);
  },
  approveGeneration: (value) => ipcRenderer.invoke("workspace:approve-generation", value),
  rejectGeneration: (value) => ipcRenderer.invoke("workspace:reject-generation", value),
  state: () => ipcRenderer.invoke("workspace:state"),
  create: (name) => ipcRenderer.invoke("workspace:create", name),
  open: () => ipcRenderer.invoke("workspace:open"),
  openRecent: (id) => ipcRenderer.invoke("workspace:recent", id),
  home: () => ipcRenderer.invoke("workspace:home"),
  renameProject: (value) => ipcRenderer.invoke("workspace:rename", value),
  removeProject: (id) => ipcRenderer.invoke("workspace:remove", id),
  chooseEngine: () => ipcRenderer.invoke("workspace:engine"),
  saveBukitPath: (path) => ipcRenderer.invoke("workspace:engine-path", path),
  pickExecutable: (engine) => ipcRenderer.invoke("settings:pick-executable", engine),
  applyTheme: () => ipcRenderer.invoke("workspace:theme"),
  editHeadline: (headline) =>
    ipcRenderer.invoke("workspace:headline", headline),
  saveSiteInfo: (value) => ipcRenderer.invoke("workspace:site-info", value),
  openSiteConfig: () => ipcRenderer.invoke("workspace:open-config"),
  revisionDiff: (value) => ipcRenderer.invoke("workspace:revision-diff", value),
  restore: (id) => ipcRenderer.invoke("workspace:restore", id),
  build: () => ipcRenderer.invoke("workspace:build"),
  cancel: () => ipcRenderer.invoke("workspace:cancel"),
  subscribe: (listener) => {
    const receive = (_event: unknown, state: State) => listener(state);
    ipcRenderer.on("workspace:changed", receive);
    return () => ipcRenderer.removeListener("workspace:changed", receive);
  },
};
// Only the app's main frame receives this bridge, never the website iframe.
if (process.isMainFrame) contextBridge.exposeInMainWorld("desktop", api);
