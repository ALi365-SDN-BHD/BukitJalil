import type { ContentSchemaProperty, ContentValue } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { api, keys } from "@/lib/api";

/**
 * Options of every query that calls Notion (plan 5.6): the token is used only on a user action, so nothing
 * refetches on its own when the window regains focus or the network returns, and a failure (missing token,
 * offline, a refused database) is not retried.
 */
export const NOTION_QUERY = { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

/** The page id of the entry being created. */
export const NEW_PAGE = "new";

export function useContentParams() {
  const { sourceId = null, databaseId = null, pageId = null } = useParams();
  return { sourceId, databaseId, pageId };
}

/** The open database's properties; read when the database is opened (a user action). */
export function useContentDatabase(sourceId: string, databaseId: string) {
  return useQuery({
    queryKey: keys.contentDatabase(sourceId, databaseId),
    queryFn: () => api.contentDatabase(sourceId, databaseId),
    ...NOTION_QUERY,
  });
}

export function useContentPage(sourceId: string, databaseId: string, pageId: string) {
  return useQuery({
    queryKey: keys.contentPage(sourceId, databaseId, pageId),
    queryFn: () => api.contentPage(sourceId, databaseId, pageId),
    enabled: pageId !== NEW_PAGE,
    ...NOTION_QUERY,
  });
}

/** The empty value of an editable property, for a new page. */
export function emptyValue(property: ContentSchemaProperty): ContentValue | null {
  switch (property.type) {
    case "title":
    case "rich_text":
      return { type: property.type, text: "" };
    case "number":
      return { type: "number", number: null };
    case "select":
    case "status":
      return { type: property.type, option: null };
    case "multi_select":
      return { type: "multi_select", options: [] };
    case "date":
      return { type: "date", start: null, end: null };
    case "checkbox":
      return { type: "checkbox", checked: false };
    case "url":
    case "email":
    case "phone_number":
      return { type: property.type, text: null };
    default:
      return null;
  }
}
