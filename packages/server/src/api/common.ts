import type { Context } from "hono";
import type { z } from "zod";
import { apiError } from "../security/guard.ts";
import { SiteError } from "../sites/location.ts";

/** Parse a JSON body with a zod schema; null (and a 400 already chosen by the caller) when invalid. */
export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | null> {
  try {
    const parsed = schema.safeParse(await c.req.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Map an expected failure to its API error; anything else goes to the generic 500 handler. */
export async function handle(c: Context, fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SiteError) return apiError(c, err.status, err.code, err.params);
    throw err;
  }
}
