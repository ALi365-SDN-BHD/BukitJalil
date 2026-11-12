import type { Hono } from "hono";
import type { AgentService } from "../agent/service.ts";
import type { AppEnv } from "../app.ts";
import { handle } from "./common.ts";

/** Settings → Skills: what Pi loads from BukitJalil's skills directory, with the on/off setting. */
export function skillRoutes(api: Hono<AppEnv>, agent: AgentService) {
  api.get("/skills", (c) => handle(c, async () => c.json(await agent.skills())));
}
