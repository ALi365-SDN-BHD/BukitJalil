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
  sourceFiles?: ThemeFiles;
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
  format: 1 | 2;
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
  lastOpenedAt?: string;
}
export interface FileChange {
  path: string;
  kind: "added" | "modified" | "deleted";
  before: string | null;
  after: string | null;
}
export interface GenerationState {
  id: string;
  projectPath: string;
  status: "running" | "review" | "applied" | "rejected" | "cancelled" | "failed";
  text: string;
  error: string | null;
  hash: string | null;
  changes: FileChange[];
}
export interface State {
  project:
    | (Omit<Project, "revisions"> & {
        path: string;
        revisions: Omit<Revision, "theme" | "sourceFiles">[];
        themeApplied: boolean;
        pages: { path: string; title: string }[];
      })
    | null;
  recent: (RecentProject & { unavailable: string | null })[];
  binary: string | null;
  binaryVersion: string | null;
  busy: boolean;
  generation: GenerationState | null;
  preview: { url: string; revisionId: string } | null;
  notice: string | null;
}
export type ChatStatus = "idle" | "starting" | "running" | "cancelling" | "completed" | "interrupted" | "failed" | "unknown";
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}
export interface Conversation {
  name: string;
  status: ChatStatus;
  messages: ChatMessage[];
  error: string | null;
}
export interface ChatState {
  connection: "disconnected" | "connecting" | "ready" | "error" | "unavailable";
  version: string | null;
  account: { type: "chatgpt" | "apiKey"; plan: string | null } | null;
  loginPending: boolean;
  error: string | null;
  binary: string | null;
  models: { id: string; name: string; defaultEffort: string; isDefault: boolean; efforts: { id: string; description: string }[] }[];
  model: string | null;
  effort: string | null;
  conversations: Record<string, Conversation>;
}
export interface DesktopAPI {
  chatState(): Promise<ChatState>;
  connectChat(): Promise<void>;
  saveCodexPath(path: string): Promise<void>;
  saveModel(value: { model: string | null; effort: string | null }): Promise<void>;
  loginChat(): Promise<void>;
  cancelLoginChat(): Promise<void>;
  sendChat(value: { projectPath: string; text: string }): Promise<void>;
  cancelChat(projectPath: string): Promise<void>;
  subscribeChat(listener: (state: ChatState) => void): () => void;
  generate(value: { projectPath: string; text: string }): Promise<void>;
  approveGeneration(value: { projectPath: string; id: string; hash: string }): Promise<void>;
  rejectGeneration(value: { projectPath: string; id: string }): Promise<void>;
  state(): Promise<State>;
  create(name: string): Promise<void>;
  open(): Promise<void>;
  openRecent(id: string): Promise<void>;
  home(): Promise<void>;
  renameProject(value: { id: string; name: string }): Promise<void>;
  removeProject(id: string): Promise<void>;
  chooseEngine(): Promise<void>;
  saveBukitPath(path: string): Promise<void>;
  pickExecutable(engine: "Bukit" | "Codex"): Promise<string | null>;
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
