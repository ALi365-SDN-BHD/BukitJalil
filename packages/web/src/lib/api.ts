import {
  ApiError,
  type ApplyRequest,
  type ApplyResult,
  AppUpdateResponse,
  type AuditReportResponse,
  type Build,
  type BuildListResponse,
  type BukitResponse,
  type ChangeSet,
  type ConfigResponse,
  type CreateSiteRequest,
  type CreateThemeRequest,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  type CurrentChange,
  type CustomModelProvider,
  type CustomModelRequest,
  type CustomModelsResponse,
  type DataResponse,
  type DataSourceRequest,
  type Deploy,
  type DeployConfigRequest,
  type DeployListResponse,
  type DeployStatusResponse,
  type ErrorCode,
  type FileDiff,
  type FileResponse,
  type FsDirsResponse,
  type GitIdentityResponse,
  type GitResponse,
  HealthResponse,
  type HistoryResponse,
  type ImportInspection,
  type ImportSiteRequest,
  type ImportThemeRequest,
  isThemeKey,
  type MediaUploadRequest,
  type MediaUploadResult,
  type ModelsResponse,
  type NotionDatabasesResponse,
  type NotionSourceSchema,
  type PanelRef,
  type PiStatus,
  type PreviewResponse,
  type ProjectKey,
  type ProviderKey,
  type ProviderLoginStatus,
  type ProviderTestResult,
  type PublishAccount,
  type PublishAccountRequest,
  parseProjectKey,
  type RestoreResult,
  type RgResponse,
  type SavedDataSource,
  type SecurityStatus,
  type SendMessageRequest,
  type SessionDetail,
  type SessionInfo,
  Settings,
  type SettingsPatch,
  type Site,
  type SiteNotionSourceRequest,
  type SitePatch,
  type SkillsResponse,
  type Theme,
  type ThemeApplyPlan,
  type ThemeApplyRequest,
  type ThemeApplyResult,
  type ThemeImportInspection,
  type ThemeResponse,
  type TreeResponse,
  type VersionDiff,
} from "@bukitjalil/shared";
import type { z } from "zod";
import { projectPath } from "./project.ts";

export type ErrorParams = Record<string, string | number | boolean>;

const lockListeners = new Set<() => void>();

/** Called whenever the server answers that the app is locked (plan 6.9); returns the unsubscribe. */
export function onAppLocked(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => lockListeners.delete(listener);
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly params: ErrorParams = {},
  ) {
    super(code);
  }
}

/**
 * Call the API. With a schema the response is validated; without one it is trusted as `T` (the types
 * shared with the server describe it, and the server is same-origin).
 */
async function request<T>(path: string, init: RequestInit = {}, schema?: z.ZodType<T>): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== "GET" && method !== "HEAD") {
    // Required on every non-GET request (plan 11); the browser adds the matching Origin.
    headers.set("Content-Type", "application/json");
    headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(body);
    if (err.success && err.data.code === "app.locked") for (const listener of lockListeners) listener();
    throw err.success
      ? new ApiRequestError(res.status, err.data.code, err.data.params)
      : new ApiRequestError(res.status, "server.internal");
  }
  return schema ? schema.parse(body) : (body as T);
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

const query = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const api = {
  health: () => request("/health", {}, HealthResponse),
  update: () => request("/update", {}, AppUpdateResponse),
  checkUpdate: (manual = true) => post<AppUpdateResponse>(`/update/check${manual ? "?manual=1" : ""}`),
  downloadUpdate: () => post<AppUpdateResponse>("/update/download"),
  cancelUpdate: () => post<AppUpdateResponse>("/update/cancel"),
  openUpdate: () => post<AppUpdateResponse>("/update/open"),
  settings: () => request("/settings", {}, Settings),
  updateSettings: (patch: SettingsPatch) =>
    request("/settings", { method: "PUT", body: JSON.stringify(patch) }, Settings),
  skills: () => request<SkillsResponse>("/skills"),
  identity: () => request<GitIdentityResponse>("/git/identity"),
  bukit: (refresh = false) => request<BukitResponse>(`/bukit${refresh ? "?refresh=1" : ""}`),
  rg: () => request<RgResponse>("/rg"),
  installRg: () => post<unknown>("/rg/install"),
  git: (refresh = false) => request<GitResponse>(`/git${refresh ? "?refresh=1" : ""}`),
  installGit: () => post<unknown>("/git/install"),
  pi: (refresh = false) => request<PiStatus>(`/pi${refresh ? "?refresh=1" : ""}`),
  security: () => request<SecurityStatus>("/security"),
  setupPin: (pin: string) => post<SecurityStatus>("/security/setup", { pin }),
  unlock: (pin: string) => post<SecurityStatus>("/security/unlock", { pin }),
  lock: () => post<SecurityStatus>("/security/lock"),
  changePin: (currentPin: string, nextPin: string) =>
    post<SecurityStatus>("/security/change-pin", { currentPin, nextPin }),
  dirs: (path: string | null, hidden = false) =>
    request<FsDirsResponse>(`/fs/dirs?${query({ ...(path ? { path } : {}), ...(hidden ? { hidden: "1" } : {}) })}`),

  sites: () => request<Site[]>("/sites"),
  site: (id: string) => request<Site>(`/sites/${id}`),
  createSite: (req: CreateSiteRequest) => post<Site>("/sites", req),
  inspectImport: (path: string, configFile?: string) =>
    post<ImportInspection>("/sites/import/inspect", { path, ...(configFile ? { configFile } : {}) }),
  importSite: (req: ImportSiteRequest) => post<Site>("/sites/import", req),
  patchSite: (id: string, patch: SitePatch) =>
    request<Site>(`/sites/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  notionSource: (id: string, index: number) => request<NotionSourceSchema>(`/sites/${id}/notion/sources/${index}`),
  setNotionSource: (id: string, req: SiteNotionSourceRequest) =>
    request<Site>(`/sites/${id}/notion-source`, { method: "PUT", body: JSON.stringify(req) }),
  recheck: (id: string) => post<Site>(`/sites/${id}/recheck`),
  openSite: (id: string) => post<null>(`/sites/${id}/open`),
  removeSite: (id: string) => request<{ leftovers: string[] }>(`/sites/${id}`, { method: "DELETE" }),

  themes: () => request<Theme[]>("/themes"),
  themeProject: (id: string) => request<Theme>(`/themes/${id}`),
  createTheme: (req: CreateThemeRequest) => post<Theme>("/themes", req),
  patchTheme: (id: string, patch: SitePatch) =>
    request<Theme>(`/themes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  recheckTheme: (id: string) => post<Theme>(`/themes/${id}/recheck`),
  openTheme: (id: string) => post<null>(`/themes/${id}/open`),
  removeTheme: (id: string) => request<{ leftovers: string[] }>(`/themes/${id}`, { method: "DELETE" }),
  inspectTheme: (path: string) => post<ThemeImportInspection>("/themes/import/inspect", { path }),
  importTheme: (req: ImportThemeRequest) => post<Theme>("/themes/import", req),
  themeApplyPlan: (id: string, siteId: string) => request<ThemeApplyPlan>(`/themes/${id}/apply?${query({ siteId })}`),
  applyTheme: (id: string, req: ThemeApplyRequest) => post<ThemeApplyResult>(`/themes/${id}/apply`, req),

  // Project routes (theme development design 3.3): a site's or a theme project's, by project key.
  tree: (project: ProjectKey, ref: PanelRef, path: string) =>
    request<TreeResponse>(`${projectPath(project)}/tree?${query({ ref, path })}`),
  file: (project: ProjectKey, ref: PanelRef, path: string) =>
    request<FileResponse>(`${projectPath(project)}/file?${query({ ref, path })}`),
  config: (project: ProjectKey, ref: PanelRef) =>
    request<ConfigResponse>(`${projectPath(project)}/config?${query({ ref })}`),
  theme: (project: ProjectKey, ref: PanelRef) =>
    request<ThemeResponse>(`${projectPath(project)}/theme?${query({ ref })}`),
  data: (project: ProjectKey, ref: PanelRef) => request<DataResponse>(`${projectPath(project)}/data?${query({ ref })}`),

  builds: (project: ProjectKey) => request<BuildListResponse>(`${projectPath(project)}/builds`),
  audit: (id: string, ref: PanelRef) => request<AuditReportResponse>(`/sites/${id}/audit?ref=${ref}`),
  build: (project: ProjectKey, buildId: string) => request<Build>(`${projectPath(project)}/builds/${buildId}`),
  startBuild: (project: ProjectKey, ref: PanelRef = "main") => post<Build>(`${projectPath(project)}/builds`, { ref }),
  openPreview: (project: ProjectKey, ref: PanelRef = "main") =>
    post<PreviewResponse>(`${projectPath(project)}/preview`, { ref }),

  currentChange: (project: ProjectKey) => request<CurrentChange>(`${projectPath(project)}/changes/current`),
  setSitePlugin: (siteId: string, pluginId: string, enabled: boolean) =>
    request<CurrentChange>(`/sites/${siteId}/plugins/${pluginId}`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  changeDiff: (changeId: string, path: string) => request<FileDiff>(`/changes/${changeId}/diff?${query({ path })}`),
  applyChange: (changeId: string, req: ApplyRequest) => post<ApplyResult>(`/changes/${changeId}/apply`, req),
  rejectChange: (changeId: string) => post<ChangeSet>(`/changes/${changeId}/reject`),
  history: (project: ProjectKey, skip: number) =>
    request<HistoryResponse>(`${projectPath(project)}/history?${query({ skip: String(skip) })}`),
  versionDiff: (project: ProjectKey, commit: string) =>
    request<VersionDiff>(`${projectPath(project)}/history/${commit}/diff`),
  versionFileDiff: (project: ProjectKey, commit: string, path: string) =>
    request<FileDiff>(`${projectPath(project)}/history/${commit}/diff?${query({ path })}`),
  restore: (project: ProjectKey, commit: string) =>
    post<RestoreResult>(`${projectPath(project)}/history/${commit}/restore`),

  sessions: (project: ProjectKey) => request<SessionInfo[]>(`${projectPath(project)}/sessions`),
  createSession: (project: ProjectKey) => post<SessionInfo>(`${projectPath(project)}/sessions`),
  uploadMedia: (siteId: string, req: MediaUploadRequest) => post<MediaUploadResult>(`/sites/${siteId}/media`, req),
  deployStatus: (siteId: string) => request<DeployStatusResponse>(`/sites/${siteId}/deploy`),
  saveDeployConfig: (siteId: string, req: DeployConfigRequest) =>
    request<DeployStatusResponse>(`/sites/${siteId}/deploy`, { method: "PUT", body: JSON.stringify(req) }),
  deploys: (siteId: string) => request<DeployListResponse>(`/sites/${siteId}/deploys`),
  deploy: (siteId: string, deployId: string) => request<Deploy>(`/sites/${siteId}/deploys/${deployId}`),
  startDeploy: (siteId: string, commit: string) => post<Deploy>(`/sites/${siteId}/deploys`, { commit }),
  stopDeploy: (siteId: string, deployId: string) => post<Deploy>(`/sites/${siteId}/deploys/${deployId}/stop`),
  session: (id: string) => request<SessionDetail>(`/sessions/${id}`),
  renameSession: (id: string, title: string | null) =>
    request<SessionInfo>(`/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteSession: (id: string) => request<null>(`/sessions/${id}`, { method: "DELETE" }),
  sendMessage: (id: string, req: z.input<typeof SendMessageRequest>) =>
    post<SessionInfo>(`/sessions/${id}/messages`, req),
  abortSession: (id: string) => post<SessionInfo>(`/sessions/${id}/abort`),
  forkSession: (id: string, entryId: string) => post<SessionInfo>(`/sessions/${id}/fork`, { entryId }),

  models: () => request<ModelsResponse>("/models"),
  setProviderKey: (provider: string, apiKey: string) =>
    request<ProviderKey>(`/providers/${encodeURIComponent(provider)}/key`, {
      method: "PUT",
      body: JSON.stringify({ apiKey }),
    }),
  removeProviderKey: (provider: string) =>
    request<ProviderKey>(`/providers/${encodeURIComponent(provider)}/key`, { method: "DELETE" }),
  dataSources: () => request<SavedDataSource[]>("/data-sources"),
  createDataSource: (req: DataSourceRequest) => post<SavedDataSource>("/data-sources", req),
  updateDataSource: (id: string, req: DataSourceRequest) =>
    request<SavedDataSource>(`/data-sources/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(req),
    }),
  deleteDataSource: (id: string) => request<null>(`/data-sources/${encodeURIComponent(id)}`, { method: "DELETE" }),
  notionDatabases: (id: string) =>
    request<NotionDatabasesResponse>(`/data-sources/${encodeURIComponent(id)}/notion/databases`),
  publishAccounts: () => request<PublishAccount[]>("/publish-accounts"),
  createPublishAccount: (req: PublishAccountRequest) => post<PublishAccount>("/publish-accounts", req),
  updatePublishAccount: (id: string, req: PublishAccountRequest) =>
    request<PublishAccount>(`/publish-accounts/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(req),
    }),
  deletePublishAccount: (id: string) =>
    request<null>(`/publish-accounts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  testProvider: (provider: string, model: string) =>
    post<ProviderTestResult>(`/providers/${encodeURIComponent(provider)}/test`, { model }),
  startProviderLogin: (provider: string) => post<{ id: string }>(`/providers/${encodeURIComponent(provider)}/oauth`),
  providerLogin: (provider: string, id: string) =>
    request<ProviderLoginStatus>(`/providers/${encodeURIComponent(provider)}/oauth/${encodeURIComponent(id)}`),
  answerProviderLogin: (provider: string, id: string, value: string) =>
    post<ProviderLoginStatus>(`/providers/${encodeURIComponent(provider)}/oauth/${encodeURIComponent(id)}/answer`, {
      value,
    }),
  cancelProviderLogin: (provider: string, id: string) =>
    request<ProviderLoginStatus>(`/providers/${encodeURIComponent(provider)}/oauth/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  logoutProvider: (provider: string) =>
    request<null>(`/providers/${encodeURIComponent(provider)}/oauth`, { method: "DELETE" }),
  customModels: () => request<CustomModelsResponse>("/custom-models"),
  createCustomModel: (req: CustomModelRequest) => post<CustomModelProvider>("/custom-models", req),
  updateCustomModel: (id: string, req: CustomModelRequest) =>
    request<CustomModelProvider>(`/custom-models/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(req),
    }),
  deleteCustomModel: (id: string) => request<null>(`/custom-models/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

/** Address of a file as bytes: `raw` for verified bitmaps (an <img> source), `download` for any file. */
export function fileUrl(project: ProjectKey, ref: PanelRef, path: string, as: "raw" | "download"): string {
  return `/api${projectPath(project)}/file?${query({ ref, path, as })}`;
}

/** The theme project's deliverable as a zip (design 7); the route sets the file name. */
export const themeExportUrl = (id: string) => `/api/themes/${id}/export`;

/** Query keys, so mutations can invalidate exactly what they change. */
export const keys = {
  settings: ["settings"] as const,
  update: ["update"] as const,
  skills: ["skills"] as const,
  sites: ["sites"] as const,
  site: (id: string) => ["site", id] as const,
  themes: ["themes"] as const,
  theme: (id: string) => ["theme", id] as const,
  /** The project's own record: `site` for a site, `theme` for a theme project. */
  project: (key: ProjectKey) => {
    const ref = parseProjectKey(key);
    return ref?.kind === "theme" ? (["theme", ref.id] as const) : (["site", key] as const);
  },
  /** The list the project's record is in. */
  projects: (key: ProjectKey) => (isThemeKey(key) ? (["themes"] as const) : (["sites"] as const)),
  deploy: (siteId: string) => ["deploy", siteId] as const,
  /** Under "panel": whatever moves the default branch (applying a change, deploy settings) refreshes it too. */
  deploys: (siteId: string) => ["deploys", siteId] as const,
  panel: (project: ProjectKey, panel: string, ...rest: string[]) => ["panel", project, panel, ...rest] as const,
  builds: (project: ProjectKey) => ["builds", project] as const,
  audit: (id: string, ref: PanelRef) => ["audit", id, ref] as const,
  change: (project: ProjectKey) => ["change", project] as const,
  /** A diff never changes for one snapshot tree, so the tree is part of the key. */
  changeDiff: (changeId: string, tree: string, path: string) => ["changeDiff", changeId, tree, path] as const,
  history: (project: ProjectKey) => ["history", project] as const,
  /** A version never changes, so its diffs are kept for as long as the page lives. */
  versionDiff: (project: ProjectKey, commit: string, path?: string) =>
    ["versionDiff", project, commit, ...(path === undefined ? [] : [path])] as const,
  sessions: (project: ProjectKey) => ["sessions", project] as const,
  session: (id: string) => ["session", id] as const,
  bukit: ["bukit"] as const,
  models: ["models"] as const,
  rg: ["rg"] as const,
  git: ["git"] as const,
  pi: ["pi"] as const,
  security: ["security"] as const,
  dataSources: ["data-sources"] as const,
  publishAccounts: ["publish-accounts"] as const,
  customModels: ["custom-models"] as const,
};
