import { type ProjectKey, parseProjectKey, projectKey } from "@bukitjalil/shared";

/** The column that names a row's project in `sessions`, `change_sets` and `builds` (migration 013). */
export type OwnerColumn = "site_id" | "theme_id";

/** Which column holds `key`'s project, and its id. Throws on a malformed key: callers pass checked keys. */
export function ownerOf(key: ProjectKey): { column: OwnerColumn; id: string } {
  const ref = parseProjectKey(key);
  if (!ref) throw new Error(`not a project key: ${key}`);
  return { column: ref.kind === "site" ? "site_id" : "theme_id", id: ref.id };
}

/** The project key of a row that has both owner columns. */
export function rowProject(row: { site_id: string | null; theme_id: string | null }): ProjectKey {
  if (row.site_id !== null) return projectKey({ kind: "site", id: row.site_id });
  if (row.theme_id !== null) return projectKey({ kind: "theme", id: row.theme_id });
  throw new Error("row has no project");
}
