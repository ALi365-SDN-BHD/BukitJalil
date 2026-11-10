import { ForkRequest, SendMessageRequest, type SessionDetail, SessionPatch } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AgentService } from "../agent/service.ts";
import type { AppEnv } from "../app.ts";
import { apiError } from "../security/guard.ts";
import { body, handle } from "./common.ts";

/** AI sessions (plan 9.1); what they do arrives on the event stream. */
export function sessionRoutes(api: Hono<AppEnv>, agent: AgentService) {
  api.get("/sites/:siteId/sessions", (c) => handle(c, () => c.json(agent.listInfo(c.req.param("siteId")))));

  api.post("/sites/:siteId/sessions", (c) =>
    handle(c, () => {
      const record = agent.create(c.req.param("siteId"));
      return c.json(agent.info(record.id), 201);
    }),
  );

  api.get("/sessions/:sessionId", (c) =>
    handle(c, async () => {
      const id = c.req.param("sessionId");
      const session = agent.info(id);
      const res: SessionDetail = { session, messages: await agent.messages(id) };
      return c.json(res);
    }),
  );

  api.patch("/sessions/:sessionId", (c) =>
    handle(c, async () => {
      const req = await body(c, SessionPatch);
      if (!req) return apiError(c, 400, "request.invalid_body");
      const id = c.req.param("sessionId");
      agent.rename(id, req.title);
      return c.json(agent.info(id));
    }),
  );

  api.delete("/sessions/:sessionId", (c) =>
    handle(c, async () => {
      await agent.delete(c.req.param("sessionId"));
      return c.body(null, 204);
    }),
  );

  // 202: the message is accepted; the reply streams on /events.
  api.post("/sessions/:sessionId/messages", (c) =>
    handle(c, async () => {
      const req = await body(c, SendMessageRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      const id = c.req.param("sessionId");
      await agent.send(id, req.text, { followUp: req.mode === "followUp" });
      return c.json(agent.info(id), 202);
    }),
  );

  api.post("/sessions/:sessionId/abort", (c) =>
    handle(c, async () => {
      const id = c.req.param("sessionId");
      await agent.stop(id);
      return c.json(agent.info(id));
    }),
  );

  api.post("/sessions/:sessionId/fork", (c) =>
    handle(c, async () => {
      const req = await body(c, ForkRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      const record = await agent.fork(c.req.param("sessionId"), req.entryId);
      return c.json(agent.info(record.id), 201);
    }),
  );
}
