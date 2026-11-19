import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanSvg, loadCapture } from "../src/themes/capture.ts";
import { tinyPng } from "./fixtures/images.ts";

describe("captured SVGs (design 6.2)", () => {
  it("removes scripts, event handlers and external references but keeps the drawing", () => {
    const svg = cleanSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><style>@import url(https://evil.example/x.css); .a{background:url(https://evil.example/x.png)}</style><rect fill="red"/><a xlink:href="https://evil.example/"><circle/></a><use href="#shape"/></svg>',
    );
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("onload");
    expect(svg).not.toContain("evil.example");
    expect(svg).not.toContain("@import");
    expect(svg).toContain("<rect");
    expect(svg).toContain('href="#shape"');
    expect(() => cleanSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>')).toThrow();
  });

  it("removes unquoted and entity-encoded external links too", () => {
    const svg = cleanSvg(
      '<svg><image href=https://evil.example/x.png/><image href="&#104;ttps://evil.example/y.png"/><style>.b{background:url(&#104;ttps://evil.example/z.png)}</style><use href="#ok"/></svg>',
    );
    expect(svg).not.toContain("evil.example");
    expect(svg).not.toContain("&#104;");
    expect(svg).toContain('href="#ok"');
  });
});

describe("capture validation (design 6.2)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bj-capture-test-"));
  const id = "0123456789abcdef0123456789abcdef";

  function write(overrides: { manifest?: unknown; html?: string } = {}): void {
    const dir = path.join(root, id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, "pages", "1"), { recursive: true });
    fs.mkdirSync(path.join(dir, "reference"), { recursive: true });
    fs.writeFileSync(path.join(dir, "pages", "1", "index.html"), overrides.html ?? "<h1>ok</h1>");
    fs.writeFileSync(path.join(dir, "pages", "1", "styles.css"), "h1{}");
    fs.writeFileSync(path.join(dir, "pages", "1", "meta.json"), "{}");
    fs.writeFileSync(path.join(dir, "reference", "1-1280.png"), tinyPng());
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify(
        overrides.manifest ?? {
          format: 1,
          id,
          origin: "https://example.com",
          title: "Example",
          pages: [
            {
              url: "https://example.com/",
              title: "Example",
              html: "pages/1/index.html",
              css: "pages/1/styles.css",
              meta: "pages/1/meta.json",
              screenshots: ["reference/1-1280.png"],
            },
          ],
          reference: ["reference/1-1280.png"],
          assets: [],
        },
      ),
    );
  }

  it("accepts a well-formed capture", () => {
    write();
    const capture = loadCapture(root, id);
    expect(capture.references.has("capture-1-1280.png")).toBe(true);
    expect(capture.files.get("pages/1/index.html")?.toString()).toBe("<h1>ok</h1>");
  });

  it("refuses a page on another site, a path escape and a non-image screenshot", () => {
    write({
      manifest: {
        format: 1,
        id,
        origin: "https://example.com",
        title: "Example",
        pages: [
          {
            url: "https://other.example/",
            title: "Other",
            html: "pages/1/index.html",
            css: "pages/1/styles.css",
            meta: "pages/1/meta.json",
            screenshots: ["reference/1-1280.png"],
          },
        ],
        reference: ["reference/1-1280.png"],
        assets: [],
      },
    });
    expect(() => loadCapture(root, id)).toThrow(expect.objectContaining({ code: "theme.capture_invalid" }));

    write();
    const dir = path.join(root, id);
    fs.writeFileSync(path.join(dir, "reference", "1-1280.png"), "not a png");
    expect(() => loadCapture(root, id)).toThrow(expect.objectContaining({ code: "theme.capture_invalid" }));
  });
});
