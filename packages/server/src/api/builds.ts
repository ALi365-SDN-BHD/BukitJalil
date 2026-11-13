import { AuditQuery, type BuildListResponse, BuildRequest, PreviewRequest } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import type { BuildService } from "../builds/service.ts";
import { apiError } from "../security/guard.ts";
import { body, handle } from "./common.ts";

/** Builds and previews (plan 9.1). */
export function buildRoutes(api: Hono<AppEnv>, builds: BuildService) {
  // 202: the build keeps running; the list shows when it ends.
  api.post("/sites/:siteId/builds", (c) =>
    handle(c, async () => {
      const req = await body(c, BuildRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(await builds.start(c.req.param("siteId"), req.ref), 202);
    }),
  );

  api.get("/sites/:siteId/builds", (c) =>
    handle(c, () => {
      const res: BuildListResponse = { builds: builds.list(c.req.param("siteId")) };
      return c.json(res);
    }),
  );

  api.get("/sites/:siteId/builds/:buildId", (c) =>
    handle(c, () => c.json(builds.get(c.req.param("siteId"), c.req.param("buildId")))),
  );

  // The SEO / GEO report panel (plan 10.4).
  api.get("/sites/:siteId/audit", (c) =>
    handle(c, () => {
      const q = AuditQuery.safeParse(c.req.query());
      if (!q.success) return apiError(c, 400, "request.invalid_query");
      return c.json(builds.auditReport(c.req.param("siteId"), q.data.ref));
    }),
  );

  // POST: opening a preview binds a port, and GET requests must not change anything (plan 11).
  api.post("/sites/:siteId/preview", (c) =>
    handle(c, async () => {
      const req = await body(c, PreviewRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(await builds.openPreview(c.req.param("siteId"), req.ref));
    }),
  );
}
