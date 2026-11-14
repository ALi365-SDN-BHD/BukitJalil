/** What the desktop app's preload script exposes (plan M7, packages/desktop/src/preload.ts). */
export interface DesktopBridge {
  desktop: true;
  /** The system folder dialog, opened at `start`; the chosen folder, or null when cancelled. */
  pickFolder(start?: string): Promise<string | null>;
  /** Tell the desktop app the chosen language, for its menus and About panel. */
  setLocale?(locale: string): void;
}

/** The bridge in the desktop app, null in a browser. */
export function desktopBridge(): DesktopBridge | null {
  const bridge = (window as { bukitjalil?: DesktopBridge }).bukitjalil;
  return bridge?.desktop === true ? bridge : null;
}
