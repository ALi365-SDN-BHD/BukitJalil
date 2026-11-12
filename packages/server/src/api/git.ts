import type { GitResponse } from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import type { GitService } from "../git/service.ts";
import { apiError } from "../security/guard.ts";
import { handle } from "./common.ts";

/** Git status and Homebrew-backed install/update (plan 6.3). */
export function gitRoutes(api: Hono<AppEnv>, git: GitService) {
  api.get("/git", (c) =>
    handle(c, async () => {
      const body: GitResponse = {
        status: await git.status(c.req.query("refresh") === "1"),
        install: git.install,
      };
      return c.json(body);
    }),
  );

  api.post("/git/install", (c) =>
    handle(c, async () => {
      if (!(await git.status()).installable) return apiError(c, 400, "git.install_unavailable");
      if (!git.start()) return apiError(c, 409, "git.install_running");
      return c.json({ install: git.install }, 202);
    }),
  );
}
