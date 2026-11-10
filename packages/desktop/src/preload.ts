import { contextBridge, ipcRenderer } from "electron";

/**
 * The only bridge to the main process (plan M7). The main process checks which page asked: the folder
 * picker answers the app's own origin, restart only the local status page.
 */
contextBridge.exposeInMainWorld("bukitjalil", {
  desktop: true,
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("desktop:pick-folder"),
  restart: (): Promise<void> => ipcRenderer.invoke("desktop:restart"),
});
