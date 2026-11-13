import { describe, expect, it } from "vitest";
import { previewBasePath } from "../src/preview/base-path.ts";

describe("previewBasePath (plan 16 #8)", () => {
  it("normalizes plain paths to /a/b/", () => {
    for (const [input, basePath] of [
      [undefined, "/"],
      [null, "/"],
      ["", "/"],
      ["/", "/"],
      [" /blog ", "/blog/"],
      ["/blog/", "/blog/"],
      ["/blog//", "/blog/"],
      ["/a/b.c/d_e~f-g", "/a/b.c/d_e~f-g/"],
    ] as const) {
      expect(previewBasePath(input)).toEqual({ ok: true, basePath });
    }
  });

  it("refuses anything that is not plain path segments", () => {
    for (const input of [
      42,
      ["/blog"],
      "blog/",
      "https://example.com/blog/",
      "//evil.example/",
      "/a//b/",
      "/../x/",
      "/a/./b/",
      "/a b/",
      "/a%2fb/",
      "/a\\b/",
      "/a?x=1",
      "/a#x",
      "/中文/",
      `/${"a".repeat(201)}/`,
      `/${Array(11).fill("a").join("/")}/`,
    ]) {
      expect(previewBasePath(input)).toMatchObject({ ok: false });
    }
  });
});
