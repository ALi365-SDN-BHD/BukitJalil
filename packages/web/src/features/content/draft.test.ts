import { describe, expect, it } from "vitest";
import { draftOf } from "./draft";

// Plan 5.6: one save sends the draft with the edit time it was started on, and keeps what is typed meanwhile.
const T1 = "2026-11-21T08:00:00.000Z";
const T2 = "2026-11-21T09:00:00.000Z";
const T3 = "2026-11-21T10:00:00.000Z";

describe("content draft", () => {
  it("keeps the edit time of the first change, or an older one", () => {
    draftOf("a").setBody("new", "old", T2);
    expect(draftOf("a").base).toBe(T2);
    draftOf("a").set("Tags", { type: "checkbox", checked: true }, null, T3);
    expect(draftOf("a").base).toBe(T2);
    draftOf("a").set("Tags", { type: "checkbox", checked: false }, null, T1);
    expect(draftOf("a").base).toBe(T1);
    // Undoing every change empties the draft and forgets its time.
    draftOf("a").setBody("old", "old", T3);
    draftOf("a").set("Tags", { type: "checkbox", checked: false }, { type: "checkbox", checked: false }, T3);
    expect(draftOf("a")).toMatchObject({ dirty: false, base: "" });
    // Another page starts empty.
    draftOf("a").setBody("x", "", T1);
    expect(draftOf("b")).toMatchObject({ dirty: false, body: null, base: "" });
  });

  it("drops only what a save sent, rebasing what was typed meanwhile", () => {
    const key = "c";
    draftOf(key).setBody("sent", "old", T1);
    draftOf(key).set("Done", { type: "checkbox", checked: true }, null, T1);
    // Typed while the body was being saved.
    draftOf(key).setBody("sent and more", "old", T1);
    draftOf(key).bodySaved("sent", T2);
    expect(draftOf(key)).toMatchObject({ body: "sent and more", base: T2 });
    draftOf(key).bodySaved("sent and more", T3);
    expect(draftOf(key)).toMatchObject({ body: null, base: T3, propertiesDirty: true });

    const sent = { Done: { type: "checkbox", checked: true } } as const;
    draftOf(key).set("Done", { type: "checkbox", checked: false }, null, T3);
    draftOf(key).propertiesSaved(sent, T3);
    expect(draftOf(key).changes).toEqual({ Done: { type: "checkbox", checked: false } });
    draftOf(key).propertiesSaved({ Done: { type: "checkbox", checked: false } }, T3);
    expect(draftOf(key)).toMatchObject({ dirty: false, base: "" });
  });
});
