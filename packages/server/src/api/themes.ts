import { CreateThemeRequest, SitePatch } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import type { BuildService } from "../builds/service.ts";
import { apiError } from "../security/guard.ts";
import { type ThemeService, themeKey } from "../themes/service.ts";
import { body, handle } from "./common.ts";

export interface ThemeRouteDeps {
  themes: ThemeService;
  builds: BuildService;
}

/**
 * Theme projects (theme development design 3.3). Their conversations, change sets, builds, previews and
 * panels are the project routes under /themes/:themeId. New ones come from a description (T1); import and
 * clone come with T2 and T3.
 */
export function themeRoutes(api: Hono<AppEnv>, { themes, builds }: ThemeRouteDeps) {
  api.get("/themes", (c) => c.json(themes.list()));

  api.post("/themes", (c) =>
    handle(c, async () => {
      const req = await body(c, CreateThemeRequest);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(await themes.create(req), 201);
    }),
  );

  api.get("/themes/:themeId", (c) => handle(c, () => c.json(themes.get(c.req.param("themeId")))));

  api.patch("/themes/:themeId", (c) =>
    handle(c, async () => {
      const req = await body(c, SitePatch);
      if (!req) return apiError(c, 400, "request.invalid_body");
      return c.json(themes.patch(c.req.param("themeId"), req));
    }),
  );

  api.post("/themes/:themeId/recheck", (c) =>
    handle(c, async () => c.json(await themes.recheck(c.req.param("themeId")))),
  );

  api.post("/themes/:themeId/open", (c) =>
    handle(c, () => {
      themes.touch(c.req.param("themeId"));
      return c.body(null, 204);
    }),
  );

  api.delete("/themes/:themeId", (c) =>
    handle(c, async () => {
      const id = c.req.param("themeId");
      const result = await themes.remove(id);
      await builds.forgetProject(themeKey(id));
      return c.json(result);
    }),
  );
}
