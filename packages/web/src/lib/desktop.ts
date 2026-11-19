/** What the desktop app's preload script exposes (plan M7, packages/desktop/src/preload.ts). */
export interface CaptureRequest {
  urls: string[];
  images: boolean;
  fonts: boolean;
  authorized: boolean;
}
export interface CapturePreflight {
  origin: string;
  http: boolean;
  pages: { url: string; robotsAllowed: boolean }[];
}
export interface CaptureResult {
  captureId: string;
  title: string;
  pages: { url: string; title: string }[];
  files: number;
  bytes: number;
}
export interface CaptureProgress {
  phase: "page" | "collect" | "screenshots" | "assets";
  url: string;
  index: number;
  total: number;
}
export type CaptureOutcome<T> = { ok: true; result: T } | { ok: false; error: string };

export interface DesktopBridge {
  desktop: true;
  /** The host platform, used to keep unsupported update paths hidden. */
  platform: string;
  /** The system folder dialog, opened at `start`; the chosen folder, or null when cancelled. */
  pickFolder(start?: string): Promise<string | null>;
  /** The system save dialog; the chosen path, or null when cancelled. */
  saveFile(name: string, data: ArrayBuffer): Promise<string | null>;
  /** The system file dialog for a zip; the chosen file, or null when cancelled. */
  pickFile(start?: string): Promise<string | null>;
  /** Same-origin and robots.txt checks before a site capture (design 6.1). */
  capturePreflight(urls: string[]): Promise<CaptureOutcome<CapturePreflight>>;
  /** Capture the pages in a hidden, locked-down window (design 6.2). */
  startCapture(request: CaptureRequest): Promise<CaptureOutcome<CaptureResult>>;
  /** Progress of a running capture; returns the unsubscribe function. */
  onCaptureProgress(callback: (progress: CaptureProgress) => void): () => void;
  /** Tell the desktop app the chosen language, for its menus and About panel. */
  setLocale?(locale: string): void;
}

/** The bridge in the desktop app, null in a browser. */
export function desktopBridge(): DesktopBridge | null {
  const bridge = (window as { bukitjalil?: DesktopBridge }).bukitjalil;
  return bridge?.desktop === true ? bridge : null;
}
