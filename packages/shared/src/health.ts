import { z } from "zod";

export const MIN_GIT_VERSION = "2.38.0";

export const GitHealth = z.object({
  ok: z.boolean(),
  version: z.string().nullable(),
  /** Set when git is missing or too old. */
  problem: z.enum(["missing", "too_old"]).nullable(),
});

export const HealthResponse = z.object({
  ok: z.boolean(),
  version: z.string(),
  git: GitHealth,
  bukit: z.object({ ok: z.boolean(), detail: z.literal("not_checked_yet") }),
  pi: z.object({ ok: z.boolean(), detail: z.literal("not_checked_yet") }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
