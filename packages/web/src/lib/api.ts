import {
  ApiError,
  type Build,
  type BuildListResponse,
  type BukitResponse,
  type ConfigResponse,
  type CreateSiteRequest,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  type DataResponse,
  type ErrorCode,
  type FileResponse,
  type FsDirsResponse,
  type GitIdentityResponse,
  HealthResponse,
  type ImportInspection,
  type ImportSiteRequest,
  type PanelRef,
  type PreviewResponse,
  type RgResponse,
  type SendMessageRequest,
  type SessionDetail,
  type SessionInfo,
  Settings,
  type SettingsPatch,
  type Site,
  type SitePatch,
  type ThemeResponse,
  type TreeResponse,
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
  identity: () => request<GitIdentityResponse>("/git/identity"),
  bukit: () => request<BukitResponse>("/bukit"),
  installBukit: () => post<unknown>("/bukit/install"),
  rg: () => request<RgResponse>("/rg"),
  installRg: () => post<unknown>("/rg/install"),
  dirs: (path: string | null, hidden = false) =>
    request<FsDirsResponse>(`/fs/dirs?${query({ ...(path ? { path } : {}), ...(hidden ? { hidden: "1" } : {}) })}`),

  sites: () => request<Site[]>("/sites"),
  site: (id: string) => request<Site>(`/sites/${id}`),
  createSite: (req: CreateSiteRequest) => post<Site>("/sites", req),
  inspectImport: (path: string) => post<ImportInspection>("/sites/import/inspect", { path }),
  importSite: (req: ImportSiteRequest) => post<Site>("/sites/import", req),
  patchSite: (id: string, patch: SitePatch) =>
    request<Site>(`/sites/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
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

  sessions: (siteId: string) => request<SessionInfo[]>(`/sites/${siteId}/sessions`),
  createSession: (siteId: string) => post<SessionInfo>(`/sites/${siteId}/sessions`),
  session: (id: string) => request<SessionDetail>(`/sessions/${id}`),
  renameSession: (id: string, title: string | null) =>
    request<SessionInfo>(`/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteSession: (id: string) => request<null>(`/sessions/${id}`, { method: "DELETE" }),
  sendMessage: (id: string, req: z.input<typeof SendMessageRequest>) =>
    post<SessionInfo>(`/sessions/${id}/messages`, req),
  abortSession: (id: string) => post<SessionInfo>(`/sessions/${id}/abort`),
  forkSession: (id: string, entryId: string) => post<SessionInfo>(`/sessions/${id}/fork`, { entryId }),
};

/** Address of a file as bytes: `raw` for verified bitmaps (an <img> source), `download` for any file. */
export function fileUrl(siteId: string, ref: PanelRef, path: string, as: "raw" | "download"): string {
  return `/api/sites/${siteId}/file?${query({ ref, path, as })}`;
}

/** Query keys, so mutations can invalidate exactly what they change. */
export const keys = {
  settings: ["settings"] as const,
  sites: ["sites"] as const,
  site: (id: string) => ["site", id] as const,
  panel: (id: string, panel: string, ...rest: string[]) => ["panel", id, panel, ...rest] as const,
  builds: (id: string) => ["builds", id] as const,
  sessions: (siteId: string) => ["sessions", siteId] as const,
  session: (id: string) => ["session", id] as const,
  bukit: ["bukit"] as const,
  rg: ["rg"] as const,
};
