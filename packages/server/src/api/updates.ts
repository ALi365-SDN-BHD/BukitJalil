import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import type { UpdateService } from "../updates/service.ts";

/** App update check, user-authorized download, and handing the installer to the desktop app. */
export function updateRoutes(api: Hono<AppEnv>, updates: UpdateService) {
  api.get("/update", (c) => c.json(updates.status()));
  api.post("/update/check", async (c) => c.json(await updates.check(true, c.req.query("manual") === "1")));
  api.post("/update/download", (c) => c.json(updates.startDownload(), 202));
  api.post("/update/cancel", (c) => c.json(updates.cancel()));
  api.post("/update/open", async (c) => c.json(await updates.open()));
}
