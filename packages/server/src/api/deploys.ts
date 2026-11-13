import { DeployConfigRequest, type DeployListResponse, DeployRequest } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import type { DeployService } from "../deploys/service.ts";
import { apiError } from "../security/guard.ts";
import { body, handle } from "./common.ts";

/** Publishing (plan 14 M6, 9.1). */
export function deployRoutes(api: Hono<AppEnv>, deploys: DeployService) {
  api.get("/sites/:siteId/deploy", (c) => handle(c, async () => c.json(await deploys.status(c.req.param("siteId")))));

  // Save the account and target in the deploy area; this writes one config commit to site.yaml.
  api.put("/sites/:siteId/deploy", (c) =>
    handle(c, async () => {
      const req = await body(c, DeployConfigRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(await deploys.saveConfig(c.req.param("siteId"), req));
    }),
  );

  // 202: the publish keeps running; events and the list show its steps and end.
  api.post("/sites/:siteId/deploys", (c) =>
    handle(c, async () => {
      const req = await body(c, DeployRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(await deploys.start(c.req.param("siteId"), req.commit), 202);
    }),
  );

  api.get("/sites/:siteId/deploys", (c) =>
    handle(c, () => {
      const res: DeployListResponse = { deploys: deploys.list(c.req.param("siteId")) };
      return c.json(res);
    }),
  );

  api.get("/sites/:siteId/deploys/:deployId", (c) =>
    handle(c, () => c.json(deploys.get(c.req.param("siteId"), c.req.param("deployId")))),
  );

  api.post("/sites/:siteId/deploys/:deployId/stop", (c) =>
    handle(c, () => c.json(deploys.stop(c.req.param("siteId"), c.req.param("deployId")))),
  );
}
