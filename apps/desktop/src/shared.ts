export type ThemeFiles = Record<string, string>;
export interface ThemeCopy {
  name: "Canopy";
  version: "1.0.0";
  files: ThemeFiles;
}
export interface Revision {
  id: string;
  createdAt: string;
  headline: string;
  summary: string;
  theme: ThemeCopy | null;
}
export interface BuildRecord {
  id: string;
  revisionId: string;
  startedAt: string;
  status: "running" | "success" | "failed" | "cancelled" | "interrupted";
  log: string;
  error?: string;
}
export interface Project {
  format: 1;
  name: string;
  currentRevisionId: string;
  revisions: Revision[];
  lastBuild?: BuildRecord;
  lastSuccessfulBuild?: { id: string; revisionId: string };
}
export interface RecentProject {
  id: string;
  path: string;
  name: string;
}
export interface State {
  project:
    | (Omit<Project, "revisions"> & {
        path: string;
        revisions: Omit<Revision, "theme">[];
        themeApplied: boolean;
      })
    | null;
  recent: RecentProject[];
  binary: string | null;
  busy: boolean;
  preview: { url: string; revisionId: string } | null;
  notice: string | null;
}
export interface DesktopAPI {
  state(): Promise<State>;
  create(name: string): Promise<void>;
  open(): Promise<void>;
  openRecent(id: string): Promise<void>;
  chooseEngine(): Promise<void>;
  applyTheme(): Promise<void>;
  editHeadline(headline: string): Promise<void>;
  restore(id: string): Promise<void>;
  build(): Promise<void>;
  cancel(): Promise<void>;
  subscribe(listener: (state: State) => void): () => void;
}
declare global {
  interface Window {
    desktop: DesktopAPI;
  }
}
