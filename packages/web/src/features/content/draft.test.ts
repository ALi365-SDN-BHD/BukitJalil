import type { ContentBlock } from "@bukitjalil/shared";
import { describe, expect, it } from "vitest";
import { changeOf, draftOf } from "./draft";

const p = (text: string): ContentBlock[] => [{ type: "paragraph", text: text ? [{ text }] : [] }];

// Plan 5.6: one save sends the draft with the edit time it was started on, and keeps what is typed meanwhile.
const T1 = "2026-11-21T08:00:00.000Z";
const T2 = "2026-11-21T09:00:00.000Z";
const T3 = "2026-11-21T10:00:00.000Z";

describe("content draft", () => {
  it("keeps the edit time of the first change, or an older one", () => {
    draftOf("a").setBody(p("new"), p("old"), T2, "original");
    expect(draftOf("a").base).toBe(T2);
    draftOf("a").set("Tags", { type: "checkbox", checked: true }, null, T3);
    expect(draftOf("a").base).toBe(T2);
    draftOf("a").set("Tags", { type: "checkbox", checked: false }, null, T1);
    expect(draftOf("a").base).toBe(T1);
    // Undoing every change empties the draft and forgets its time.
    draftOf("a").setBody(p("old"), p("old"), T3, "updated");
    draftOf("a").set("Tags", { type: "checkbox", checked: false }, { type: "checkbox", checked: false }, T3);
    expect(draftOf("a")).toMatchObject({ dirty: false, base: "" });
    // Another page starts empty.
    draftOf("a").setBody(p("x"), p(""), T1, "other");
    expect(draftOf("b")).toMatchObject({ dirty: false, body: null, base: "" });
    // A body that cannot be saved keeps the draft dirty until it can again.
    // It keeps the editor's document, so a remount of the editor loses nothing.
    const unsaved = { doc: [], images: new Map() };
    draftOf("e").setProblem("nesting", unsaved, T1, "original");
    expect(draftOf("e")).toMatchObject({ dirty: true, problem: "nesting", unsaved, base: T1 });
    draftOf("e").setBody(p("fixed draft"), p("old"), T2, "server changed");
    expect(draftOf("e").bodyRevision).toBe("original");
    draftOf("e").setBody(p("old"), p("old"), T2, "server changed");
    expect(draftOf("e")).toMatchObject({ dirty: false, problem: null, unsaved: null, base: "" });
  });

  it("drops only what a save sent, rebasing what was typed meanwhile", () => {
    const key = "c";
    draftOf(key).setBody(p("sent"), p("old"), T1, "original");
    draftOf(key).set("Done", { type: "checkbox", checked: true }, null, T1);
    // Typed while the body was being saved.
    draftOf(key).setBody(p("sent and more"), p("old"), T1, "original");
    draftOf(key).bodySaved(p("sent"), T2, "saved");
    expect(draftOf(key).bodyRevision).toBe("saved");
    expect(draftOf(key)).toMatchObject({ body: p("sent and more"), base: T2 });
    draftOf(key).bodySaved(p("sent and more"), T3, "latest");
    expect(draftOf(key)).toMatchObject({ body: null, base: T3, propertiesDirty: true });

    const sent = { Done: { type: "checkbox", checked: true } } as const;
    draftOf(key).set("Done", { type: "checkbox", checked: false }, null, T3);
    draftOf(key).propertiesSaved(sent, T3);
    expect(draftOf(key).changes).toEqual({ Done: { type: "checkbox", checked: false } });
    draftOf(key).propertiesSaved({ Done: { type: "checkbox", checked: false } }, T3);
    expect(draftOf(key)).toMatchObject({ dirty: false, base: "" });
  });

  it("reads only the draft's own changes, whatever a property is named", () => {
    expect(changeOf({}, "constructor")).toBeUndefined();
    expect(changeOf({}, "toString")).toBeUndefined();
    const value = { type: "checkbox", checked: true } as const;
    expect(changeOf({ constructor: value }, "constructor")).toEqual(value);
  });
});
