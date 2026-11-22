import type { ContentBlock, ContentValue } from "@bukitjalil/shared";
import { useSyncExternalStore } from "react";
import { canonicalNotionId } from "@/lib/project";
import { type BlocksProblem, sameBlocks, type Unsaved } from "./blocks";

/**
 * The unsaved changes of the open page (plan 5.6): its properties and its body. The title and body are edited
 * in the middle column and the other properties in the right one, and one save sends them all, so the two
 * columns share this store. It holds one page at a time: editing another page starts it empty.
 */
type Changes = Readonly<Record<string, ContentValue>>;
interface Draft {
  key: string;
  changes: Changes;
  /** The edited body; null while it is unchanged. */
  body: readonly ContentBlock[] | null;
  /** Why the body as it is in the editor cannot be saved; `body` is then its last version that can. */
  problem: BlocksProblem | null;
  /** With a problem: the editor's document, to load again if the editor remounts. */
  unsaved: Unsaved | null;
  /**
   * Notion's edit time of what the first change was made on; a save sends it, so anything written in Notion
   * since (also while the draft waited on another page, or a cached body was shown) is a conflict.
   */
  base: string;
}

const NONE: Changes = {};
const empty = (key: string): Draft => ({ key, changes: NONE, body: null, problem: null, unsaved: null, base: "" });
let draft: Draft = empty("");
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function replace(next: Draft) {
  draft = next;
  for (const listener of listeners) listener();
}

const isEmpty = (d: Draft) => Object.keys(d.changes).length === 0 && d.body === null && d.problem === null;

/** The draft of `key`, or an empty one to start from. */
const current = (key: string): Draft => (draft.key === key ? draft : empty(key));

/**
 * `next` with its base: the edit time this change was made on, or the draft's own if that is older (the
 * body and the properties are read apart, so one of them can be older). Notion's ISO times sort as text.
 */
const changed = (before: Draft, next: Draft, base: string): Draft =>
  isEmpty(next)
    ? { ...next, base: "" }
    : { ...next, base: isEmpty(before) || (base && base < before.base) ? base : before.base };

const same = (a: ContentValue | null, b: ContentValue | null) => JSON.stringify(a) === JSON.stringify(b);

/** The draft's change of `name`: only its own entries, so a property named `constructor` is not inherited. */
export const changeOf = (changes: Changes, name: string): ContentValue | undefined =>
  Object.hasOwn(changes, name) ? changes[name] : undefined;

/** What a save of the page with this draft key is called, so both columns can tell one is running. */
export const saveKey = (key: string) => ["content-save", key] as const;

export const draftKey = (sourceId: string, databaseId: string, pageId: string) => `${sourceId}/${databaseId}/${pageId}`;

/**
 * Whether this entry has unsaved changes, open or not: the draft stays when the user leaves the page. The
 * database and page ids may be given with or without Notion's dashes.
 */
export function useEntryDirty(sourceId: string, databaseId: string, pageId: string): boolean {
  const d = useSyncExternalStore(subscribe, () => draft);
  if (isEmpty(d)) return false;
  const [source, database = "", page = ""] = d.key.split("/");
  return (
    source === sourceId &&
    canonicalNotionId(database) === canonicalNotionId(databaseId) &&
    canonicalNotionId(page) === canonicalNotionId(pageId)
  );
}

export function useDraft(key: string) {
  useSyncExternalStore(subscribe, () => draft);
  return draftOf(key);
}

/** The draft of `key` as it is now, and what changes it; `useDraft` re-reads it on every change. */
export function draftOf(key: string) {
  const mine = current(key);
  return {
    changes: mine.changes,
    body: mine.body,
    problem: mine.problem,
    unsaved: mine.unsaved,
    base: mine.base,
    propertiesDirty: Object.keys(mine.changes).length > 0,
    dirty: !isEmpty(mine),
    /** A value equal to the saved one drops the change again. `base` is the edit time `saved` was read at. */
    set(name: string, value: ContentValue, saved: ContentValue | null, base: string) {
      const before = current(key);
      const { [name]: _, ...rest } = before.changes;
      replace(changed(before, { ...before, changes: same(value, saved) ? rest : { ...rest, [name]: value } }, base));
    },
    setBody(value: readonly ContentBlock[], saved: readonly ContentBlock[], base: string) {
      const before = current(key);
      replace(
        changed(
          before,
          { ...before, body: sameBlocks(value, saved) ? null : value, problem: null, unsaved: null },
          base,
        ),
      );
    },
    /** The body in the editor cannot be saved as it is: `unsaved` is what it holds. */
    setProblem(problem: BlocksProblem, unsaved: Unsaved, base: string) {
      const before = current(key);
      replace(changed(before, { ...before, problem, unsaved }, base));
    },
    /**
     * The body `sent` is in Notion as of `edited`. Typing since the save began stays, now based on `edited`.
     */
    bodySaved(sent: readonly ContentBlock[], edited: string) {
      if (draft.key !== key) return;
      const next = { ...draft, body: draft.body && sameBlocks(draft.body, sent) ? null : draft.body };
      replace(isEmpty(next) ? { ...next, base: "" } : { ...next, base: edited });
    },
    /** The property values `sent` are in Notion as of `edited`; changes made since the save began stay. */
    propertiesSaved(sent: Changes, edited: string) {
      if (draft.key !== key) return;
      const changes = Object.fromEntries(
        Object.entries(draft.changes).filter(([name, value]) => !same(value, changeOf(sent, name) ?? null)),
      );
      const next = { ...draft, changes };
      replace(isEmpty(next) ? { ...next, base: "" } : { ...next, base: edited });
    },
    clear() {
      if (draft.key === key) replace(empty(key));
    },
  };
}
