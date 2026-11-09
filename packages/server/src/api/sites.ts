import {
  CreateSiteRequest,
  type GitIdentityResponse,
  ImportSiteRequest,
  InspectImportRequest,
  SitePatch,
} from "@bukitjalil/shared";
import type { Context, Hono } from "hono";
import type { z } from "zod";
import type { AppEnv } from "../app.ts";
import type { GitIdentity } from "../git/identity.ts";
import { apiError } from "../security/guard.ts";
import { listDirs, SiteError } from "../sites/location.ts";
import type { SiteService } from "../sites/service.ts";

/** Parse a JSON body with a zod schema; null (and a 400 already chosen by the caller) when invalid. */
async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | null> {
  try {
    const parsed = schema.safeParse(await c.req.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Map an expected failure to its API error; anything else goes to the generic 500 handler. */
async function handle(c: Context, fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SiteError) return apiError(c, err.status, err.code, err.params);
    throw err;
  }
}

/** Sites, directory picker and identity defaults (plan 9.1). */
export function siteRoutes(
  api: Hono<AppEnv>,
  deps: {
    sites: SiteService;
    readIdentity: () => Promise<GitIdentity>;
    userHome?: string;
  },
) {
  const { sites } = deps;

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

  // Run the safety checks again, e.g. after the user fixed what made the site read-only.
  api.post("/sites/:siteId/recheck", (c) => handle(c, async () => c.json(await sites.recheck(c.req.param("siteId")))));

  api.post("/sites/:siteId/open", (c) =>
    handle(c, () => {
      sites.touch(c.req.param("siteId"));
      return c.body(null, 204);
    }),
  );

  api.delete("/sites/:siteId", (c) => handle(c, async () => c.json(await sites.remove(c.req.param("siteId")))));
}
