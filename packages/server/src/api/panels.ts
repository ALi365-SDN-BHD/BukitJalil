import { FileQuery, RefQuery, TreeQuery } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import type { PanelService } from "../panels/service.ts";
import { apiError } from "../security/guard.ts";
import { handle, PROJECT_PREFIXES, projectParam } from "./common.ts";

/** `filename*` per RFC 6266/5987, plus a plain ASCII fallback. */
function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_") || "download";
  // encodeURIComponent leaves !'()* alone, but RFC 5987 does not allow them unescaped.
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Read-only panels (plan 9.1): tree, file, config, theme, data. */
export function panelRoutes(api: Hono<AppEnv>, panels: PanelService) {
  for (const prefix of PROJECT_PREFIXES)
    api.get(`${prefix}/tree`, (c) =>
      handle(c, async () => {
        const q = TreeQuery.safeParse(c.req.query());
        if (!q.success) return apiError(c, 400, "request.invalid_query");
        return c.json(await panels.tree(projectParam(c), q.data.ref, q.data.path));
      }),
    );

  for (const prefix of PROJECT_PREFIXES)
    api.get(`${prefix}/file`, (c) =>
      handle(c, async () => {
        const q = FileQuery.safeParse(c.req.query());
        if (!q.success) return apiError(c, 400, "request.invalid_query");
        const result = await panels.file(projectParam(c), q.data.ref, q.data.path, q.data.as);
        if (result.type === "json") return c.json(result.body);
        // The Buffer is sent as is: it comes from git's output, never a SharedArrayBuffer, so no copy is needed.
        const bytes = result.data as Uint8Array<ArrayBuffer>;
        c.set("cspSandbox", true);
        if (result.type === "raw") return c.body(bytes, 200, { "Content-Type": result.mime });
        return c.body(bytes, 200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": attachment(result.name),
        });
      }),
    );

  for (const prefix of PROJECT_PREFIXES)
    for (const panel of ["config", "theme", "data"] as const) {
      api.get(`${prefix}/${panel}`, (c) =>
        handle(c, async () => {
          const q = RefQuery.safeParse(c.req.query());
          if (!q.success) return apiError(c, 400, "request.invalid_query");
          return c.json(await panels[panel](projectParam(c), q.data.ref));
        }),
      );
    }
}
