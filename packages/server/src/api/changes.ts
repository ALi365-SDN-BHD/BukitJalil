import { ApplyRequest, ChangeDiffQuery, type CurrentChange } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AgentService } from "../agent/service.ts";
import type { AppEnv } from "../app.ts";
import type { BuildService } from "../builds/service.ts";
import type { ChangeService } from "../changes/service.ts";
import type { Logger } from "../log.ts";
import { apiError } from "../security/guard.ts";
import { SiteError } from "../sites/location.ts";
import { body, handle } from "./common.ts";

export interface ChangeRouteDeps {
  changes: ChangeService;
  agent: AgentService;
  builds: BuildService;
  logger: Logger;
}

/** Change sets (plan 7.2, 9.1): the current one, a file's diff, apply and reject. */
export function changeRoutes(api: Hono<AppEnv>, { changes, agent, builds, logger }: ChangeRouteDeps) {
  api.get("/sites/:siteId/changes/current", (c) =>
    handle(c, async () => {
      const siteId = c.req.param("siteId");
      const res: CurrentChange = { change: await changes.current(siteId, agent.busy(siteId)) };
      return c.json(res);
    }),
  );

  api.get("/changes/:changeId/diff", (c) =>
    handle(c, async () => {
      const q = ChangeDiffQuery.safeParse(c.req.query());
      if (!q.success) return apiError(c, 400, "request.invalid_query");
      return c.json(await changes.diff(c.req.param("changeId"), q.data.path));
    }),
  );

  api.post("/changes/:changeId/apply", (c) =>
    handle(c, async () => {
      const req = await body(c, ApplyRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      const result = await changes.apply(c.req.param("changeId"), req);
      // The default branch moved: rebuild the main preview (plan 7.2). When that cannot start now (no Bukit,
      // the site is busy), the preview stays on the previous build until the next one.
      if (result.outcome === "applied") {
        builds.start(result.change.siteId, "main").catch((err) => {
          if (err instanceof SiteError) return;
          logger.log("error", "changes.build_failed", { siteId: result.change.siteId, error: String(err) });
        });
      }
      return c.json(result);
    }),
  );

  api.post("/changes/:changeId/reject", (c) =>
    handle(c, async () => c.json(await changes.reject(c.req.param("changeId")))),
  );
}
