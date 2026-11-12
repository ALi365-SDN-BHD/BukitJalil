import { PluginToggleRequest } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AgentService } from "../agent/service.ts";
import type { AppEnv } from "../app.ts";
import type { ChangeService } from "../changes/service.ts";
import { apiError } from "../security/guard.ts";
import { SiteError } from "../sites/location.ts";
import { body, handle } from "./common.ts";

/** A Settings toggle in the site's Config panel: edit site.plugins.<id> in a reviewable change set. */
export function pluginRoutes(api: Hono<AppEnv>, { changes, agent }: { changes: ChangeService; agent: AgentService }) {
  api.put("/sites/:siteId/plugins/:pluginId", (c) =>
    handle(c, async () => {
      const req = await body(c, PluginToggleRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      const siteId = c.req.param("siteId");
      // A run is about to touch the same checkout; the site lock would refuse too, this gives a clearer code.
      if (agent.busy(siteId)) throw new SiteError("site.busy", 409, { operation: "session" });
      return c.json(await changes.setPlugin(siteId, c.req.param("pluginId"), req.enabled));
    }),
  );
}
