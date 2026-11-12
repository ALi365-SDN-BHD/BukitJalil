import { PublishAccountRequest } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import type { PublishAccountService } from "../publish/accounts.ts";
import { apiError } from "../security/guard.ts";
import { body, handle } from "./common.ts";

/** Saved publishing accounts (plan 6.5). Tokens are never returned. */
export function publishAccountRoutes(api: Hono<AppEnv>, accounts: PublishAccountService) {
  api.get("/publish-accounts", (c) => handle(c, () => c.json(accounts.list())));

  api.post("/publish-accounts", (c) =>
    handle(c, async () => {
      const req = await body(c, PublishAccountRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(accounts.create(req));
    }),
  );

  api.put("/publish-accounts/:accountId", (c) =>
    handle(c, async () => {
      const req = await body(c, PublishAccountRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(accounts.update(c.req.param("accountId"), req));
    }),
  );

  api.delete("/publish-accounts/:accountId", (c) =>
    handle(c, () => {
      accounts.remove(c.req.param("accountId"));
      return c.body(null, 204);
    }),
  );
}
