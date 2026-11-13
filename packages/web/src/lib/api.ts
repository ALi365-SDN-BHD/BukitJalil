import {
  ApiError,
  type ApplyRequest,
  type ApplyResult,
  type Build,
  type BuildListResponse,
  type BukitResponse,
  type ChangeSet,
  type ConfigResponse,
  type CreateSiteRequest,
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
  type ModelsResponse,
  type NotionDatabasesResponse,
  type PanelRef,
  type PiStatus,
  type PreviewResponse,
  type ProviderKey,
  type ProviderLoginStatus,
  type ProviderTestResult,
  type PublishAccount,
  type PublishAccountRequest,
  type RestoreResult,
  type RgResponse,
  type SavedDataSource,
  type SendMessageRequest,
  type SessionDetail,
  type SessionInfo,
  Settings,
  type SettingsPatch,
  type Site,
  type SiteNotionSourceRequest,
  type SitePatch,
  type SkillsResponse,
  type ThemeResponse,
  type TreeResponse,
  type VersionDiff,
} from "@bukitjalil/shared";
import type { z } from "zod";

export type ErrorParams = Record<string, string | number | boolean>;

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
  settings: () => request("/settings", {}, Settings),
  updateSettings: (patch: SettingsPatch) =>
    request("/settings", { method: "PUT", body: JSON.stringify(patch) }, Settings),
  skills: () => request<SkillsResponse>("/skills"),
  identity: () => request<GitIdentityResponse>("/git/identity"),
  bukit: (refresh = false, force = false) => {
    const params = new URLSearchParams();
    if (refresh) params.set("refresh", "1");
    if (force) params.set("force", "1");
    const search = params.toString();
    return request<BukitResponse>(`/bukit${search ? `?${search}` : ""}`);
  },
  installBukit: () => post<unknown>("/bukit/install"),
  rg: () => request<RgResponse>("/rg"),
  installRg: () => post<unknown>("/rg/install"),
  git: (refresh = false) => request<GitResponse>(`/git${refresh ? "?refresh=1" : ""}`),
  installGit: () => post<unknown>("/git/install"),
  pi: (refresh = false) => request<PiStatus>(`/pi${refresh ? "?refresh=1" : ""}`),
  dirs: (path: string | null, hidden = false) =>
    request<FsDirsResponse>(`/fs/dirs?${query({ ...(path ? { path } : {}), ...(hidden ? { hidden: "1" } : {}) })}`),

  sites: () => request<Site[]>("/sites"),
  site: (id: string) => request<Site>(`/sites/${id}`),
  createSite: (req: CreateSiteRequest) => post<Site>("/sites", req),
  inspectImport: (path: string) => post<ImportInspection>("/sites/import/inspect", { path }),
  importSite: (req: ImportSiteRequest) => post<Site>("/sites/import", req),
  patchSite: (id: string, patch: SitePatch) =>
    request<Site>(`/sites/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  setNotionSource: (id: string, req: SiteNotionSourceRequest) =>
    request<Site>(`/sites/${id}/notion-source`, { method: "PUT", body: JSON.stringify(req) }),
  recheck: (id: string) => post<Site>(`/sites/${id}/recheck`),
  openSite: (id: string) => post<null>(`/sites/${id}/open`),
  removeSite: (id: string) => request<{ leftovers: string[] }>(`/sites/${id}`, { method: "DELETE" }),

  tree: (id: string, ref: PanelRef, path: string) => request<TreeResponse>(`/sites/${id}/tree?${query({ ref, path })}`),
  file: (id: string, ref: PanelRef, path: string) => request<FileResponse>(`/sites/${id}/file?${query({ ref, path })}`),
  config: (id: string, ref: PanelRef) => request<ConfigResponse>(`/sites/${id}/config?${query({ ref })}`),
  theme: (id: string, ref: PanelRef) => request<ThemeResponse>(`/sites/${id}/theme?${query({ ref })}`),
  data: (id: string, ref: PanelRef) => request<DataResponse>(`/sites/${id}/data?${query({ ref })}`),

  builds: (id: string) => request<BuildListResponse>(`/sites/${id}/builds`),
  build: (id: string, buildId: string) => request<Build>(`/sites/${id}/builds/${buildId}`),
  startBuild: (id: string, ref: PanelRef = "main") => post<Build>(`/sites/${id}/builds`, { ref }),
  openPreview: (id: string, ref: PanelRef = "main") => post<PreviewResponse>(`/sites/${id}/preview`, { ref }),

  currentChange: (siteId: string) => request<CurrentChange>(`/sites/${siteId}/changes/current`),
  setSitePlugin: (siteId: string, pluginId: string, enabled: boolean) =>
    request<CurrentChange>(`/sites/${siteId}/plugins/${pluginId}`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  changeDiff: (changeId: string, path: string) => request<FileDiff>(`/changes/${changeId}/diff?${query({ path })}`),
  applyChange: (changeId: string, req: ApplyRequest) => post<ApplyResult>(`/changes/${changeId}/apply`, req),
  rejectChange: (changeId: string) => post<ChangeSet>(`/changes/${changeId}/reject`),
  history: (siteId: string, skip: number) =>
    request<HistoryResponse>(`/sites/${siteId}/history?${query({ skip: String(skip) })}`),
  versionDiff: (siteId: string, commit: string) => request<VersionDiff>(`/sites/${siteId}/history/${commit}/diff`),
  versionFileDiff: (siteId: string, commit: string, path: string) =>
    request<FileDiff>(`/sites/${siteId}/history/${commit}/diff?${query({ path })}`),
  restore: (siteId: string, commit: string) => post<RestoreResult>(`/sites/${siteId}/history/${commit}/restore`),

  sessions: (siteId: string) => request<SessionInfo[]>(`/sites/${siteId}/sessions`),
  createSession: (siteId: string) => post<SessionInfo>(`/sites/${siteId}/sessions`),
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
export function fileUrl(siteId: string, ref: PanelRef, path: string, as: "raw" | "download"): string {
  return `/api/sites/${siteId}/file?${query({ ref, path, as })}`;
}

/** Query keys, so mutations can invalidate exactly what they change. */
export const keys = {
  settings: ["settings"] as const,
  skills: ["skills"] as const,
  sites: ["sites"] as const,
  site: (id: string) => ["site", id] as const,
  deploy: (siteId: string) => ["deploy", siteId] as const,
  deploys: (siteId: string) => ["deploys", siteId] as const,
  panel: (id: string, panel: string, ...rest: string[]) => ["panel", id, panel, ...rest] as const,
  builds: (id: string) => ["builds", id] as const,
  change: (siteId: string) => ["change", siteId] as const,
  /** A diff never changes for one snapshot tree, so the tree is part of the key. */
  changeDiff: (changeId: string, tree: string, path: string) => ["changeDiff", changeId, tree, path] as const,
  history: (siteId: string) => ["history", siteId] as const,
  /** A version never changes, so its diffs are kept for as long as the page lives. */
  versionDiff: (siteId: string, commit: string, path?: string) =>
    ["versionDiff", siteId, commit, ...(path === undefined ? [] : [path])] as const,
  sessions: (siteId: string) => ["sessions", siteId] as const,
  session: (id: string) => ["session", id] as const,
  bukit: ["bukit"] as const,
  models: ["models"] as const,
  rg: ["rg"] as const,
  git: ["git"] as const,
  pi: ["pi"] as const,
  dataSources: ["data-sources"] as const,
  publishAccounts: ["publish-accounts"] as const,
  customModels: ["custom-models"] as const,
};
