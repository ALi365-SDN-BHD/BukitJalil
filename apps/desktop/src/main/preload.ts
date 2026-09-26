import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI, State } from "../shared";

const api: DesktopAPI = {
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
