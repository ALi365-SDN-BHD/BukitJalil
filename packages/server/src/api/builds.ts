import { AuditQuery, type BuildListResponse, BuildRequest, PreviewRequest } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import type { BuildService } from "../builds/service.ts";
import { apiError } from "../security/guard.ts";
import { body, handle, PROJECT_PREFIXES, projectParam } from "./common.ts";

/** Builds and previews (plan 9.1). */
export function buildRoutes(api: Hono<AppEnv>, builds: BuildService) {
  // 202: the build keeps running; the list shows when it ends.
  for (const prefix of PROJECT_PREFIXES)
    api.post(`${prefix}/builds`, (c) =>
      handle(c, async () => {
        const req = await body(c, BuildRequest);
        if (!req) return apiError(c, 400, "request.invalid_body");
        return c.json(await builds.start(projectParam(c), req.ref), 202);
      }),
    );

  for (const prefix of PROJECT_PREFIXES)
    api.get(`${prefix}/builds`, (c) =>
      handle(c, () => {
        const res: BuildListResponse = { builds: builds.list(projectParam(c)) };
        return c.json(res);
      }),
    );

  for (const prefix of PROJECT_PREFIXES)
    api.get(`${prefix}/builds/:buildId`, (c) =>
      handle(c, () => c.json(builds.get(projectParam(c), c.req.param("buildId")))),
    );

  // The SEO / GEO report panel (plan 10.4).
  api.get("/sites/:siteId/audit", (c) =>
    handle(c, () => {
      const q = AuditQuery.safeParse(c.req.query());
      if (!q.success) return apiError(c, 400, "request.invalid_query");
      return c.json(builds.auditReport(projectParam(c), q.data.ref));
    }),
  );

  // POST: opening a preview binds a port, and GET requests must not change anything (plan 11).
  for (const prefix of PROJECT_PREFIXES)
    api.post(`${prefix}/preview`, (c) =>
      handle(c, async () => {
        const req = await body(c, PreviewRequest);
        if (!req) return apiError(c, 400, "request.invalid_body");
        return c.json(await builds.openPreview(projectParam(c), req.ref));
      }),
    );
}
