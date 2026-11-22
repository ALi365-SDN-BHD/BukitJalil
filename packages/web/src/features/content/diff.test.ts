import { describe, expect, it } from "vitest";
import { lineDiff } from "./diff";

// Content editor and AI design, A3: a proposal card shows the body change line by line.
const show = (before: string, after: string) =>
  lineDiff(before, after).map((l) => `${l.kind === "same" ? " " : l.kind === "removed" ? "-" : "+"}${l.text}`);

describe("body line diff", () => {
  it("keeps the common lines and marks the rest", () => {
    expect(show("a\nb\nc\nd", "a\nB\nc\nd\ne")).toEqual([" a", "-b", "+B", " c", " d", "+e"]);
    expect(show("", "new")).toEqual(["+new"]);
    expect(show("old", "")).toEqual(["-old"]);
    expect(show("same", "same")).toEqual([" same"]);
    expect(show("x\ny\nz", "y\nz\nx")).toEqual(["-x", " y", " z", "+x"]);
  });

  it("shows a very large change as replaced rather than building a huge table", () => {
    const before = Array.from({ length: 3000 }, (_, i) => `a${i}`).join("\n");
    const after = Array.from({ length: 3000 }, (_, i) => `b${i}`).join("\n");
    const lines = lineDiff(`top\n${before}\nend`, `top\n${after}\nend`);
    expect(lines[0]).toEqual({ kind: "same", text: "top" });
    expect(lines.at(-1)).toEqual({ kind: "same", text: "end" });
    expect(lines.filter((l) => l.kind === "removed")).toHaveLength(3000);
    expect(lines.filter((l) => l.kind === "added")).toHaveLength(3000);
  });
});
