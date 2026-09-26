import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI, State, ChatState } from "../shared";

const api: DesktopAPI = {
  chatState: () => ipcRenderer.invoke("chat:state"),
  connectChat: () => ipcRenderer.invoke("chat:connect"),
  loginChat: () => ipcRenderer.invoke("chat:login"),
  cancelLoginChat: () => ipcRenderer.invoke("chat:cancel-login"),
  sendChat: (value) => ipcRenderer.invoke("chat:send", value),
  cancelChat: (projectPath) => ipcRenderer.invoke("chat:cancel", projectPath),
  subscribeChat: (listener) => {
    const receive = (_event: unknown, state: ChatState) => listener(state);
    ipcRenderer.on("chat:changed", receive);
    return () => ipcRenderer.removeListener("chat:changed", receive);
  },
  generate: (value) => ipcRenderer.invoke("workspace:generate", value),
  approveGeneration: (value) => ipcRenderer.invoke("workspace:approve-generation", value),
  rejectGeneration: (value) => ipcRenderer.invoke("workspace:reject-generation", value),
  state: () => ipcRenderer.invoke("workspace:state"),
  create: (name) => ipcRenderer.invoke("workspace:create", name),
  open: () => ipcRenderer.invoke("workspace:open"),
  openRecent: (id) => ipcRenderer.invoke("workspace:recent", id),
  chooseEngine: () => ipcRenderer.invoke("workspace:engine"),
  applyTheme: () => ipcRenderer.invoke("workspace:theme"),
  editHeadline: (headline) =>
    ipcRenderer.invoke("workspace:headline", headline),
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
