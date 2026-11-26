import { MediaUploadRequest } from "@bukitjalil/shared";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AgentService } from "../agent/service.ts";
import type { AppEnv } from "../app.ts";
import type { MediaService } from "../media/service.ts";
import { apiError } from "../security/guard.ts";
import { SiteError } from "../sites/location.ts";
import { body } from "./common.ts";

const MAX_UPLOAD_BODY = 14 * 1024 * 1024;

/** Material uploads (design 4.1): one JSON file per request, into the site's AI working copy. */
export function mediaRoutes(api: Hono<AppEnv>, { media, agent }: { media: MediaService; agent: AgentService }) {
  api.post(
    "/sites/:siteId/media",
    bodyLimit({
      maxSize: MAX_UPLOAD_BODY,
      onError: (c) => apiError(c, 413, "request.too_large"),
    }),
    async (c) => {
      const siteId = c.req.param("siteId");
      // The upload would write the same checkout a run is using; the lock would also refuse.
      if (agent.busy(siteId)) throw new SiteError("site.busy", 409, { operation: "session" });
      const req = await body(c, MediaUploadRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(await media.upload(siteId, req), 201);
    },
  );
}
