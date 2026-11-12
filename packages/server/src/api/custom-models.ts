import { CustomModelRequest } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { CustomModelStore } from "../agent/custom-models.ts";
import type { AppEnv } from "../app.ts";
import { apiError } from "../security/guard.ts";
import { body, handle } from "./common.ts";

type RuntimeRegistrar = Parameters<CustomModelStore["register"]>[0];

/** Local and self-hosted OpenAI-compatible models (Ollama, LM Studio, vLLM, llama.cpp, ...). */
export function customModelRoutes(
  api: Hono<AppEnv>,
  store: CustomModelStore,
  runtime: () => Promise<RuntimeRegistrar>,
) {
  api.get("/custom-models", (c) => handle(c, () => c.json(store.list())));

  api.post("/custom-models", (c) =>
    handle(c, async () => {
      const req = await body(c, CustomModelRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      const created = store.create(req);
      try {
        store.register(await runtime(), store.get(created.id));
      } catch (err) {
        store.remove(created.id);
        throw err;
      }
      return c.json(created);
    }),
  );

  api.put("/custom-models/:id", (c) =>
    handle(c, async () => {
      const req = await body(c, CustomModelRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      const registrar = await runtime();
      const updated = store.update(c.req.param("id"), req, (provider) => store.register(registrar, provider));
      return c.json(updated);
    }),
  );

  api.delete("/custom-models/:id", (c) =>
    handle(c, async () => {
      const id = c.req.param("id");
      store.get(id);
      store.remove(id);
      (await runtime()).unregisterProvider(id);
      return c.body(null, 204);
    }),
  );
}
