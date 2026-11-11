import type { ChangedFileStatus, PanelRef } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { api, keys } from "@/lib/api";

/** The site's open change set (plan 7.2); kept current by `change` events. */
export function useCurrentChange(siteId: string) {
  const query = useQuery({ queryKey: keys.change(siteId), queryFn: () => api.currentChange(siteId) });
  return { ...query, change: query.data?.change ?? null };
}

/**
 * Which version the read-only panels show (plan 10.2), from ?ref= in the URL so all panels agree.
 * "change" only while a change set is open; otherwise the main version.
 */
export function usePanelRef(siteId: string): [PanelRef, (ref: PanelRef) => void] {
  const [params, setParams] = useSearchParams();
  const { change, data } = useCurrentChange(siteId);
  const wanted = params.get("ref") === "change";
  const ref: PanelRef = wanted && change ? "change" : "main";
  // Once no change set is open, forget the choice, so the next one does not switch the panels by itself.
  useEffect(() => {
    if (wanted && data && !data.change)
      setParams(
        (p) => {
          p.delete("ref");
          return p;
        },
        { replace: true },
      );
  }, [wanted, data, setParams]);
  const set = (next: PanelRef) =>
    setParams(
      (p) => {
        if (next === "change") p.set("ref", "change");
        else p.delete("ref");
        return p;
      },
      { replace: true },
    );
  return [ref, set];
}

/** Text colour of a changed file's name. */
export const statusTone: Record<ChangedFileStatus, string> = {
  added: "text-emerald-700 dark:text-emerald-400",
  modified: "text-amber-700 dark:text-amber-400",
  deleted: "text-destructive line-through",
  type_changed: "text-sky-700 dark:text-sky-400",
};

/** One-letter marks, as git shows them. */
export const statusMark: Record<ChangedFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  type_changed: "T",
};
