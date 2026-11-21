import type { ContentValue } from "@bukitjalil/shared";
import { useSyncExternalStore } from "react";

/**
 * The unsaved property changes of the open page (plan 5.6). The title is edited in the middle column and the
 * other properties in the right one, and one save sends both, so the two columns share this store. It holds
 * one page at a time: opening another page starts it empty.
 */
type Changes = Readonly<Record<string, ContentValue>>;

const NONE: Changes = {};
let draft: { key: string; changes: Changes } = { key: "", changes: NONE };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function replace(next: typeof draft) {
  draft = next;
  for (const listener of listeners) listener();
}

const same = (a: ContentValue | null, b: ContentValue | null) => JSON.stringify(a) === JSON.stringify(b);

export const draftKey = (sourceId: string, databaseId: string, pageId: string) => `${sourceId}/${databaseId}/${pageId}`;

export function useDraft(key: string) {
  const current = useSyncExternalStore(subscribe, () => draft);
  const changes = current.key === key ? current.changes : NONE;
  return {
    changes,
    dirty: Object.keys(changes).length > 0,
    /** A value equal to the saved one drops the change again. */
    set(name: string, value: ContentValue, saved: ContentValue | null) {
      const { [name]: _, ...rest } = draft.key === key ? draft.changes : NONE;
      replace({ key, changes: same(value, saved) ? rest : { ...rest, [name]: value } });
    },
    clear() {
      if (draft.key === key) replace({ key, changes: NONE });
    },
  };
}
