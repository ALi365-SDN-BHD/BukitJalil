import { DataSourceRequest } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import type { DataSourceService } from "../data-sources/service.ts";
import { apiError } from "../security/guard.ts";
import { body, handle } from "./common.ts";

/** Saved Notion sources used when creating a site (plan 6.5). Tokens are never returned. */
export function dataSourceRoutes(api: Hono<AppEnv>, dataSources: DataSourceService) {
  api.get("/data-sources", (c) => handle(c, () => c.json(dataSources.list())));

  api.post("/data-sources", (c) =>
    handle(c, async () => {
      const req = await body(c, DataSourceRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(dataSources.create(req));
    }),
  );

  api.put("/data-sources/:dataSourceId", (c) =>
    handle(c, async () => {
      const req = await body(c, DataSourceRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(dataSources.update(c.req.param("dataSourceId"), req));
    }),
  );

  api.delete("/data-sources/:dataSourceId", (c) =>
    handle(c, () => {
      dataSources.remove(c.req.param("dataSourceId"));
      return c.body(null, 204);
    }),
  );

  // The databases one Notion token can read; the site-creation picker asks for this per source.
  api.get("/data-sources/:dataSourceId/notion/databases", (c) =>
    handle(c, async () => c.json({ databases: await dataSources.notionDatabases(c.req.param("dataSourceId")) })),
  );
}
