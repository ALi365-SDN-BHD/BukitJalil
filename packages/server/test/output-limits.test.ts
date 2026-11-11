import { describe, expect, it } from "vitest";
import { buildReport, limitMessages } from "../src/builds/service.ts";
import { CAPTURE_GAP, SecretScrubber, StreamCapture } from "../src/bukit/runner.ts";

// Bukit 2.0.x logs everything to stderr; a large build must still report the error at its end.

const warn = (i: number) => ({ level: "Warn", msg: `w${i}` });

describe("SecretScrubber", () => {
  it("masks a secret split across chunks and never lets part of it through", () => {
    const secret = "ghp_abcdefghijklmnop";
    const s = new SecretScrubber([secret]);
    let out = "";
    const text = `remote https://x:${secret}@github.com/a/b\nend ${secret}`;
    for (let i = 0; i < text.length; i += 3) {
      const piece = s.push(text.slice(i, i + 3));
      expect(piece).not.toContain("ghp_abc");
      out += piece;
    }
    out += s.flush();
    expect(out).toBe("remote https://x:[token]@github.com/a/b\nend [token]");
  });

  it("passes text through unchanged without secrets", () => {
    const s = new SecretScrubber(["short"]);
    expect(s.push("short text")).toBe("short text");
    expect(s.flush()).toBe("");
  });
});

describe("StreamCapture", () => {
  it("keeps everything under the cap", () => {
    const c = new StreamCapture(10, 10);
    c.push("ab\n");
    c.push("cd\n");
    expect(c.text()).toBe("ab\ncd\n");
  });

  it("adds no gap marker when nothing was left out, and never splits a line across the gap", () => {
    const c = new StreamCapture(10, 100);
    for (const chunk of ["aaaa\nbb", "bb\ncccc", "\ndddd\n"]) c.push(chunk);
    expect(c.text()).toBe("aaaa\nbbbb\ncccc\ndddd\n");

    const d = new StreamCapture(10, 12);
    for (const chunk of ["aaaa\nbb", "bb\nccccccc", "c\n", "dddddd\neeeeee\nffff\n"]) d.push(chunk);
    const text = d.text();
    expect(text.startsWith("aaaa\nbbbb\n")).toBe(true);
    expect(text).toContain(CAPTURE_GAP);
    expect(text.endsWith("eeeeee\nffff\n")).toBe(true);
    for (const line of text.split("\n").filter((l) => l && l !== CAPTURE_GAP)) expect(line).toMatch(/^(\w)\1*$/);
  });

  it("keeps whole lines of the start and the end, with a gap marker between", () => {
    const c = new StreamCapture(8, 16);
    for (let i = 0; i < 50; i++) c.push(`line${String(i).padStart(2, "0")}\n`);
    const text = c.text();
    expect(text.startsWith("line00\n")).toBe(true);
    expect(text).toContain(CAPTURE_GAP);
    expect(text.endsWith("line48\nline49\n")).toBe(true);
    // Every kept line is whole.
    for (const line of text.split("\n").filter((l) => l && l !== CAPTURE_GAP)) expect(line).toMatch(/^line\d\d$/);
  });
});

describe("limitMessages", () => {
  it("keeps the order and makes room for errors that come after many warnings", () => {
    const list = [...Array.from({ length: 10 }, (_, i) => warn(i)), { level: "Error", msg: "boom" }];
    expect(limitMessages(list, 20)).toBe(list);
    expect(limitMessages(list, 4)).toEqual([warn(0), warn(1), warn(2), { level: "Error", msg: "boom" }]);
    const errors = Array.from({ length: 5 }, (_, i) => ({ level: "error", msg: `e${i}` }));
    expect(limitMessages([warn(0), ...errors], 3)).toEqual(errors.slice(0, 3));
  });

  it("is what buildReport uses", () => {
    const stderr = [
      ...Array.from({ length: 300 }, (_, i) => JSON.stringify({ ts: "t", level: "Warn", msg: `event=x n=${i}` })),
      JSON.stringify({ ts: "t", level: "Error", msg: "event=build.failed" }),
    ].join("\n");
    const report = buildReport({ exitCode: 2, stdout: "", stderr, durationMs: 1, stopped: null });
    expect(report.messages).toHaveLength(200);
    expect(report.messages.at(-1)).toEqual({ level: "Error", msg: "event=build.failed" });
  });
});
