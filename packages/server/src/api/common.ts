import { isProjectId, type ProjectKey, projectKey } from "@bukitjalil/shared";
import type { Context } from "hono";
import type { z } from "zod";
import { SiteError } from "../sites/location.ts";

/**
 * Route prefixes of the two kinds of project (theme development design 3.3): a route every project has is
 * registered under both, and its handler reads the project with `projectParam`.
 */
export const PROJECT_PREFIXES = ["/sites/:siteId", "/themes/:themeId"] as const;

/** The project key of a route under one of PROJECT_PREFIXES; 404 for an id that cannot be one. */
export function projectParam(c: Context): ProjectKey {
  const params = c.req.param() as Record<string, string | undefined>;
  const themeId = params.themeId;
  if (themeId !== undefined) {
    if (!isProjectId(themeId)) throw new SiteError("theme.not_found", 404);
    return projectKey({ kind: "theme", id: themeId });
  }
  const siteId = params.siteId;
  if (siteId === undefined || !isProjectId(siteId)) throw new SiteError("site.not_found", 404);
  return siteId;
}

/** Parse a JSON body with a zod schema; null (and a 400 already chosen by the caller) when invalid. */
export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | null> {
  try {
    const parsed = schema.safeParse(await c.req.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** `filename*` per RFC 6266/5987, plus a plain ASCII fallback. */
export function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_") || "download";
  // encodeURIComponent leaves !'()* alone, but RFC 5987 does not allow them unescaped.
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
