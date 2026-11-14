import { contextBridge, ipcRenderer } from "electron";

/**
 * The only bridge to the main process (plan M7). The main process checks which page asked: the folder
 * picker answers the app's own origin, restart only the local status page; the
 * app's language, only the app's own origin.
 */
contextBridge.exposeInMainWorld("bukitjalil", {
  desktop: true,
  pickFolder: (start?: string): Promise<string | null> => ipcRenderer.invoke("desktop:pick-folder", start),
  restart: (): Promise<void> => ipcRenderer.invoke("desktop:restart"),
  setLocale: (locale: string): void => ipcRenderer.send("desktop:locale", locale),
});
