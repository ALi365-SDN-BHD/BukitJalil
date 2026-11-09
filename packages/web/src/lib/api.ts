import {
  ApiError,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  type ErrorCode,
  HealthResponse,
  Settings,
  type SettingsPatch,
} from "@bukitjalil/shared";
import type { z } from "zod";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
  ) {
    super(code);
  }
}

async function request<T>(schema: z.ZodType<T>, path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== "GET" && method !== "HEAD") {
    // Required on every non-GET request (plan 11); the browser adds the matching Origin.
    headers.set("Content-Type", "application/json");
    headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(body);
    throw new ApiRequestError(res.status, err.success ? err.data.code : "server.internal");
  }
  return schema.parse(body);
}

export const api = {
  health: () => request(HealthResponse, "/health"),
  settings: () => request(Settings, "/settings"),
  updateSettings: (patch: SettingsPatch) =>
    request(Settings, "/settings", { method: "PUT", body: JSON.stringify(patch) }),
};
