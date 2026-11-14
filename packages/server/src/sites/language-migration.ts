import { isMap, isScalar, isSeq, parseDocument, type YAMLMap } from "yaml";
import { DIFF } from "../changes/diff.ts";
import type { GitRunner } from "../git/run.ts";

/**
 * The language settings Bukit 2.1 changed (plan 8.7): `site.language` is refused, and a multilingual site
 * that does not set `defaultLanguageInSubdir` moves its default language to the output root. A migration
 * rewrites site.yaml so it builds again and keeps the addresses it was published at.
 */
export type LanguagePlan =
  | { needed: false }
  | { needed: true; ok: false; reason: "bad_language" | "bad_languages" | "default_not_listed" }
  | {
      needed: true;
      ok: true;
      /** site.yaml after the migration. */
      text: string;
      /**
       * The site has a one-entry `languages` list, which Bukit 2.0 built under /<lang>/ and 2.1 builds at the
       * root; no setting keeps the old addresses, so the card says so.
       */
      movesToRoot: boolean;
    };

/** What migrating `text` (site.yaml) would do; a file that cannot be read is left to Bukit's own errors. */
export function planLanguageMigration(text: string): LanguagePlan {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length > 0) return { needed: false };
  const site = doc.get("site");
  if (!isMap(site)) return { needed: false };
  const map = site as YAMLMap;
  const hasLanguage = map.has("language");
  const listNode = map.get("languages", true);
  const listed: unknown[] = isSeq(listNode) ? listNode.toJSON() : [];
  const languages = listed.filter((l): l is string => typeof l === "string" && l.trim() !== "");
  const keepSubdir = listed.length >= 2 && !map.has("defaultLanguageInSubdir");
  if (!hasLanguage && !keepSubdir) return { needed: false };
  // Bukit 2.1 takes only plain, distinct codes; anything else is the user's to fix, not ours to guess.
  // Bukit compares codes trimmed and without case, for duplicates and for defaultLanguage alike.
  const key = (code: string) => code.trim().toLowerCase();
  if (languages.length !== listed.length || new Set(languages.map(key)).size !== languages.length) {
    return { needed: true, ok: false, reason: "bad_languages" };
  }

  const languageNode = map.get("language", true);
  const language = isScalar(languageNode) ? languageNode.value : languageNode;
  const blank = language === null || language === undefined || (typeof language === "string" && language.trim() === "");
  if (hasLanguage && !blank && typeof language !== "string") return { needed: true, ok: false, reason: "bad_language" };

  // site.language only counts when there is no list: Bukit 2.0 ignored it next to site.languages.
  const after = languages.length > 0 ? languages : !blank ? [(language as string).trim()] : [];
  const defaultLanguage = map.get("defaultLanguage");
  if (typeof defaultLanguage === "string" && after.length > 0 && !after.map(key).includes(key(defaultLanguage))) {
    return { needed: true, ok: false, reason: "default_not_listed" };
  }

  if (hasLanguage) {
    const index = map.items.findIndex((pair) => isScalar(pair.key) && pair.key.value === "language");
    const removed = map.items[index];
    if (languages.length === 0 && after.length > 0) {
      const node = doc.createNode(after);
      node.flow = true;
      if (isScalar(removed?.value) && removed.value.comment) node.comment = removed.value.comment;
      // An empty or broken `languages` key is replaced; otherwise the list takes site.language's place.
      if (map.has("languages")) {
        map.set("languages", node);
        map.items.splice(index, 1);
      } else {
        const pair = doc.createPair("languages", node);
        // A comment line written above site.language stays above the list.
        if (isScalar(removed?.key) && removed.key.commentBefore && isScalar(pair.key)) {
          pair.key.commentBefore = removed.key.commentBefore;
        }
        map.items.splice(index, 1, pair);
      }
    } else {
      map.items.splice(index, 1);
      // Keep a comment written on the removed line, on the list it gave way to.
      if (isScalar(removed?.value) && removed.value.comment && isSeq(listNode)) {
        listNode.comment = [listNode.comment, removed.value.comment].filter(Boolean).join(" /");
      }
    }
  }
  if (keepSubdir) map.set("defaultLanguageInSubdir", true);
  return { needed: true, ok: true, text: doc.toString(), movesToRoot: languages.length === 1 };
}

/** The patch from site.yaml at `commit` to `after`, laid out like the review diffs (plan 10.2). */
export async function siteYamlPatch(git: GitRunner, cwd: string, commit: string, after: string): Promise<string> {
  const blob = (await git.text(["hash-object", "-w", "--stdin"], { cwd, input: after })).trim();
  // --text: an attribute marking site.yaml binary would otherwise hide the change.
  const out = await git.text([...DIFF, "--text", "--end-of-options", `${commit}:site.yaml`, blob], { cwd });
  // The header names two blobs; the review view reads from the first hunk on.
  const hunk = out.indexOf("\n@@");
  return hunk < 0 ? out : out.slice(hunk + 1);
}
