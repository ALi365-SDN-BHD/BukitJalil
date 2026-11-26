import {
  ApplyRequest,
  ChangeDiffQuery,
  type CurrentChange,
  HistoryQuery,
  ObjectId,
  ReviewVersion,
  VersionDiffQuery,
} from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AgentService } from "../agent/service.ts";
import type { AppEnv } from "../app.ts";
import type { BuildService } from "../builds/service.ts";
import type { ChangeService } from "../changes/service.ts";
import type { Logger } from "../log.ts";
import { apiError } from "../security/guard.ts";
import { SiteError } from "../sites/location.ts";
import { body, PROJECT_PREFIXES, projectParam } from "./common.ts";

export interface ChangeRouteDeps {
  changes: ChangeService;
  agent: AgentService;
  builds: BuildService;
  logger: Logger;
}

/** Change sets (plan 7.2, 9.1): the current one, a file's diff, apply and reject; history and restore (7.4). */
export function changeRoutes(api: Hono<AppEnv>, { changes, agent, builds, logger }: ChangeRouteDeps) {
  for (const prefix of PROJECT_PREFIXES)
    api.get(`${prefix}/changes/current`, async (c) => {
      const project = projectParam(c);
      const res: CurrentChange = { change: await changes.current(project, agent.busy(project)) };
      return c.json(res);
    });

  api.get("/changes/:changeId/diff", async (c) => {
    const q = ChangeDiffQuery.safeParse(c.req.query());
    if (!q.success) return apiError(c, 400, "request.invalid_query");
    return c.json(await changes.diff(c.req.param("changeId"), q.data.path));
  });

  api.post("/changes/:changeId/apply", async (c) => {
    const req = await body(c, ApplyRequest);
    if (!req) return apiError(c, 400, "request.invalid_body");
    const changeId = c.req.param("changeId");
    // A running or queued conversation is about to change what the user reviewed (plan 7.2).
    if (agent.busy(changes.get(changeId).project)) throw new SiteError("site.busy", 409);
    const result = await changes.apply(changeId, req);
    // The default branch moved: rebuild the main preview (plan 7.2). When that cannot start now (no Bukit,
    // the site is busy), the preview stays on the previous build until the next one.
    if (result.outcome === "applied" || result.outcome === "partial") {
      builds.start(result.change.project, "main").catch((err) => {
        if (err instanceof SiteError) return;
        logger.log("error", "changes.build_failed", { project: result.change.project, error: String(err) });
      });
    }
    return c.json(result);
  });

  api.post("/changes/:changeId/reject", async (c) => {
    const req = await body(c, ReviewVersion);
    if (!req) return apiError(c, 400, "request.invalid_body");
    const id = c.req.param("changeId");
    if (agent.busy(changes.get(id).project)) throw new SiteError("site.busy", 409);
    return c.json(await changes.reject(id, req));
  });

  for (const prefix of PROJECT_PREFIXES)
    api.get(`${prefix}/history`, async (c) => {
      const q = HistoryQuery.safeParse(c.req.query());
      if (!q.success) return apiError(c, 400, "request.invalid_query");
      return c.json(await changes.history(projectParam(c), q.data.skip));
    });

  for (const prefix of PROJECT_PREFIXES)
    api.get(`${prefix}/history/:commit/diff`, async (c) => {
      const commit = ObjectId.safeParse(c.req.param("commit"));
      const q = VersionDiffQuery.safeParse(c.req.query());
      if (!commit.success || !q.success) return apiError(c, 400, "request.invalid_query");
      const project = projectParam(c);
      return c.json(
        q.data.path === undefined
          ? await changes.versionDiff(project, commit.data)
          : await changes.versionDiff(project, commit.data, q.data.path),
      );
    });

  for (const prefix of PROJECT_PREFIXES)
    api.post(`${prefix}/history/:commit/restore`, async (c) => {
      const commit = ObjectId.safeParse(c.req.param("commit"));
      if (!commit.success) return apiError(c, 400, "request.invalid_query");
      const project = projectParam(c);
      // A queued or running conversation would write over the restored AI checkout.
      if (agent.busy(project)) throw new SiteError("site.busy", 409);
      return c.json(await changes.restore(project, commit.data));
    });
}
