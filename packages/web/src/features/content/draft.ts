import type { ContentValue } from "@bukitjalil/shared";
import { useSyncExternalStore } from "react";

/**
 * The unsaved changes of the open page (plan 5.6): its properties and its body. The title and body are edited
 * in the middle column and the other properties in the right one, and one save sends them all, so the two
 * columns share this store. It holds one page at a time: editing another page starts it empty.
 */
type Changes = Readonly<Record<string, ContentValue>>;
interface Draft {
  key: string;
  changes: Changes;
  /** The edited body Markdown; null while it is unchanged. */
  body: string | null;
}

const NONE: Changes = {};
let draft: Draft = { key: "", changes: NONE, body: null };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function replace(next: Draft) {
  draft = next;
  for (const listener of listeners) listener();
}

/** The draft of `key`, or an empty one to start from. */
const current = (key: string): Draft => (draft.key === key ? draft : { key, changes: NONE, body: null });

const same = (a: ContentValue | null, b: ContentValue | null) => JSON.stringify(a) === JSON.stringify(b);

export const draftKey = (sourceId: string, databaseId: string, pageId: string) => `${sourceId}/${databaseId}/${pageId}`;

export function useDraft(key: string) {
  const snapshot = useSyncExternalStore(subscribe, () => draft);
  const mine = snapshot.key === key ? snapshot : current(key);
  return {
    changes: mine.changes,
    body: mine.body,
    propertiesDirty: Object.keys(mine.changes).length > 0,
    dirty: Object.keys(mine.changes).length > 0 || mine.body !== null,
    /** A value equal to the saved one drops the change again. */
    set(name: string, value: ContentValue, saved: ContentValue | null) {
      const base = current(key);
      const { [name]: _, ...rest } = base.changes;
      replace({ ...base, changes: same(value, saved) ? rest : { ...rest, [name]: value } });
    },
    setBody(value: string, saved: string) {
      replace({ ...current(key), body: value === saved ? null : value });
    },
    clearProperties() {
      if (draft.key === key) replace({ ...draft, changes: NONE });
    },
    clearBody() {
      if (draft.key === key) replace({ ...draft, body: null });
    },
    clear() {
      if (draft.key === key) replace({ key, changes: NONE, body: null });
    },
  };
}
