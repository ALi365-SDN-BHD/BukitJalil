import { SecretRequest } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { apiError } from "../security/guard.ts";
import type { SecretStore } from "../settings/secrets.ts";
import { body, handle } from "./common.ts";

/** Deploy tokens (plan 6.5, 9.1): only the source and last four characters ever leave the server. */
export function secretRoutes(api: Hono<AppEnv>, secrets: SecretStore) {
  api.get("/secrets", (c) => handle(c, () => c.json(secrets.status())));

  api.put("/secrets/:name", (c) =>
    handle(c, async () => {
      const req = await body(c, SecretRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(secrets.set(c.req.param("name"), req.value));
    }),
  );

  api.delete("/secrets/:name", (c) => handle(c, () => c.json(secrets.remove(c.req.param("name")))));
}
