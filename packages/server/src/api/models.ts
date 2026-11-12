import { ProviderKeyRequest, ProviderLoginAnswer, ProviderTestRequest } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { ModelService } from "../agent/models.ts";
import type { AppEnv } from "../app.ts";
import { apiError } from "../security/guard.ts";
import { body, handle } from "./common.ts";

/** Model settings (plan 6.5, 9.1). The chosen model and thinking level are saved with PUT /settings. */
export function modelRoutes(api: Hono<AppEnv>, models: ModelService) {
  api.get("/models", (c) => handle(c, async () => c.json(await models.list())));

  api.put("/providers/:provider/key", (c) =>
    handle(c, async () => {
      const req = await body(c, ProviderKeyRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(await models.setKey(c.req.param("provider"), req.apiKey));
    }),
  );

  api.delete("/providers/:provider/key", (c) =>
    handle(c, async () => c.json(await models.removeKey(c.req.param("provider")))),
  );

  api.post("/providers/:provider/test", (c) =>
    handle(c, async () => {
      const req = await body(c, ProviderTestRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(await models.test(c.req.param("provider"), req.model));
    }),
  );

  api.post("/providers/:provider/oauth", (c) =>
    handle(c, async () => c.json(await models.startLogin(c.req.param("provider")))),
  );

  api.get("/providers/:provider/oauth/:id", (c) =>
    handle(c, async () => c.json(models.loginStatus(c.req.param("provider"), c.req.param("id")))),
  );

  api.post("/providers/:provider/oauth/:id/answer", (c) =>
    handle(c, async () => {
      const req = await body(c, ProviderLoginAnswer);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(models.answerLogin(c.req.param("provider"), c.req.param("id"), req.value));
    }),
  );

  api.delete("/providers/:provider/oauth/:id", (c) =>
    handle(c, async () => c.json(models.cancelLogin(c.req.param("provider"), c.req.param("id")))),
  );

  api.delete("/providers/:provider/oauth", (c) =>
    handle(c, async () => {
      await models.logoutOAuth(c.req.param("provider"));
      return c.body(null, 204);
    }),
  );
}
