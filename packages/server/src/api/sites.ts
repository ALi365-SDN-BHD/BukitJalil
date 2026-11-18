import {
  CreateSiteRequest,
  type GitIdentityResponse,
  ImportSiteRequest,
  InspectImportRequest,
  type NotionSourceSchema,
  SiteNotionSourceRequest,
  SitePatch,
} from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import type { BuildService } from "../builds/service.ts";
import type { DataSourceService } from "../data-sources/service.ts";
import type { GitIdentity } from "../git/identity.ts";
import type { PanelService } from "../panels/service.ts";
import { apiError } from "../security/guard.ts";
import { listDirs, SiteError } from "../sites/location.ts";
import type { SiteService } from "../sites/service.ts";
import { body, handle } from "./common.ts";

/** Sites, directory picker and identity defaults (plan 9.1). */
export function siteRoutes(
  api: Hono<AppEnv>,
  deps: {
    sites: SiteService;
    builds: BuildService;
    dataSources: DataSourceService;
    panels: PanelService;
    readIdentity: () => Promise<GitIdentity>;
    userHome?: string;
  },
) {
  const { sites, builds, dataSources, panels } = deps;

  api.get("/fs/dirs", (c) =>
    handle(c, () =>
      c.json(listDirs(c.req.query("path"), { hidden: c.req.query("hidden") === "1", userHome: deps.userHome })),
    ),
  );

  api.get("/git/identity", async (c) => {
    const id: GitIdentityResponse = await deps.readIdentity();
    return c.json(id);
  });

  api.get("/sites", (c) => c.json(sites.list()));

  api.post("/sites", (c) =>
    handle(c, async () => {
      const req = await body(c, CreateSiteRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(await sites.create(req), 201);
    }),
  );

  api.post("/sites/import/inspect", (c) =>
    handle(c, async () => {
      const req = await body(c, InspectImportRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(await sites.inspectImport(req.path));
    }),
  );

  api.post("/sites/import", (c) =>
    handle(c, async () => {
      const req = await body(c, ImportSiteRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(await sites.import(req), 201);
    }),
  );

  api.get("/sites/:siteId", (c) => handle(c, () => c.json(sites.get(c.req.param("siteId")))));

  api.patch("/sites/:siteId", (c) =>
    handle(c, async () => {
      const req = await body(c, SitePatch);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(sites.patch(c.req.param("siteId"), req));
    }),
  );

  // Bind the saved Notion data source whose token main builds pass to Bukit. Only this route sets it (plus
  // site creation), so an imported site never gets a token it was not given.
  api.put("/sites/:siteId/notion-source", (c) =>
    handle(c, async () => {
      const req = await body(c, SiteNotionSourceRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      const id = c.req.param("siteId");
      sites.get(id);
      if (req.dataSourceId !== null) dataSources.get(req.dataSourceId);
      return c.json(await sites.bindNotionSource(id, req.dataSourceId));
    }),
  );

  // A Notion source's database fields, only when the user asks (plan 5.4): the database named on the default
  // branch, read with the bound token. The result goes to the UI only, never to the AI's tools.
  api.get("/sites/:siteId/notion/sources/:index", (c) =>
    handle(c, async () => {
      const id = c.req.param("siteId");
      if (!/^\d{1,3}$/.test(c.req.param("index"))) return apiError(c, 400, "request.invalid_query");
      const index = Number(c.req.param("index"));
      const databaseId = await panels.notionDatabaseId(id, index);
      const token = sites.notionToken(id);
      if (token === null) throw new SiteError("site.notion_unbound", 409);
      const schema = await dataSources.notionSchema(token, databaseId);
      const res: NotionSourceSchema = { index, databaseId, ...schema, readAt: new Date().toISOString() };
      return c.json(res);
    }),
  );

  // Run the safety checks again, e.g. after the user fixed what made the site read-only.
  api.post("/sites/:siteId/recheck", (c) => handle(c, async () => c.json(await sites.recheck(c.req.param("siteId")))));

  api.post("/sites/:siteId/open", (c) =>
    handle(c, () => {
      sites.touch(c.req.param("siteId"));
      return c.body(null, 204);
    }),
  );

  api.delete("/sites/:siteId", (c) =>
    handle(c, async () => {
      const id = c.req.param("siteId");
      const result = await sites.remove(id);
      await builds.forgetSite(id);
      return c.json(result);
    }),
  );
}
