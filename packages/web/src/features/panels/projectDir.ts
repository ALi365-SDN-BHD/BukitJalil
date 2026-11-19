import type { PanelRef, ProjectKey } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { ApiRequestError, api, keys } from "@/lib/api";

/** A folder's listing in one version; a folder the version does not have is an empty list, not an error. */
export function useProjectDir(project: ProjectKey, ref: PanelRef, dir: string) {
  return useQuery({
    queryKey: keys.panel(project, "dir", ref, dir),
    queryFn: async () => {
      try {
        return (await api.tree(project, ref, dir)).entries;
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === "panel.not_found") return [];
        throw err;
      }
    },
  });
}

/** Opens a file in the files panel. */
export function openFile(p: URLSearchParams, path: string): URLSearchParams {
  p.set("panel", "files");
  p.set("file", path);
  p.delete("diff");
  return p;
}
