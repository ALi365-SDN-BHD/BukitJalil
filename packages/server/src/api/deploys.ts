import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import type { DeployService } from "../deploys/service.ts";
import { handle } from "./common.ts";

/** Publishing (plan 14 M6, 9.1). */
export function deployRoutes(api: Hono<AppEnv>, deploys: DeployService) {
  api.get("/sites/:siteId/deploy", (c) => handle(c, async () => c.json(await deploys.status(c.req.param("siteId")))));
}
