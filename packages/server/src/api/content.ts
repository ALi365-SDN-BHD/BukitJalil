import {
  CONTENT_PROPERTY_NAME_MAX,
  ContentBodyUpdate,
  ContentPageCreate,
  ContentPageUpdate,
  ContentSortDirection,
} from "@bukitjalil/shared";
import type { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import type { NotionContentService } from "../data-sources/notion-content.ts";
import { apiError } from "../security/guard.ts";
import { body } from "./common.ts";

const DATABASE = "/content/sources/:sourceId/databases/:databaseId";
const PAGE = `${DATABASE}/pages/:pageId`;
const QUERY_MAX = 200;

/**
 * Content management (plan 5.6): Notion pages read and written with a data source's token. Saves go
 * straight to Notion, with no review or version in BukitJalil.
 */
export function contentRoutes(api: Hono<AppEnv>, content: NotionContentService) {
  api.get(DATABASE, async (c) => c.json(await content.database(c.req.param("sourceId"), c.req.param("databaseId"))));

  api.get(`${DATABASE}/pages`, async (c) => {
    const { cursor, search, sort, direction } = c.req.query();
    const dir = direction === undefined ? undefined : ContentSortDirection.safeParse(direction);
    if (
      [cursor, search].some((x) => x !== undefined && x.length > QUERY_MAX) ||
      (sort !== undefined && sort.length > CONTENT_PROPERTY_NAME_MAX) ||
      (dir !== undefined && !dir.success)
    ) {
      return apiError(c, 400, "request.invalid_body");
    }
    return c.json(
      await content.entries(c.req.param("sourceId"), c.req.param("databaseId"), {
        ...(cursor ? { cursor } : {}),
        ...(search?.trim() ? { search: search.trim() } : {}),
        ...(sort ? { sort } : {}),
        ...(dir?.success ? { direction: dir.data } : {}),
      }),
    );
  });

  api.post(`${DATABASE}/pages`, async (c) => {
    const req = await body(c, ContentPageCreate);
    if (!req) return apiError(c, 400, "request.invalid_body");
    return c.json(await content.create(c.req.param("sourceId"), c.req.param("databaseId"), req));
  });

  api.get(PAGE, async (c) =>
    c.json(await content.page(c.req.param("sourceId"), c.req.param("databaseId"), c.req.param("pageId"))),
  );

  api.patch(PAGE, async (c) => {
    const req = await body(c, ContentPageUpdate);
    if (!req) return apiError(c, 400, "request.invalid_body");
    return c.json(await content.update(c.req.param("sourceId"), c.req.param("databaseId"), c.req.param("pageId"), req));
  });

  api.get(`${PAGE}/body`, async (c) =>
    c.json(await content.body(c.req.param("sourceId"), c.req.param("databaseId"), c.req.param("pageId"))),
  );

  api.put(`${PAGE}/body`, async (c) => {
    const req = await body(c, ContentBodyUpdate);
    if (!req) return apiError(c, 400, "request.invalid_body");
    return c.json(
      await content.saveBody(c.req.param("sourceId"), c.req.param("databaseId"), c.req.param("pageId"), req),
    );
  });

  api.delete(PAGE, async (c) => {
    await content.trash(c.req.param("sourceId"), c.req.param("databaseId"), c.req.param("pageId"));
    return c.body(null, 204);
  });
}
