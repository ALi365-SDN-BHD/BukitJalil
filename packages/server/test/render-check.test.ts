import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProjectKey } from "@bukitjalil/shared";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { type DesktopChannel, type DesktopInbound, requestRenderCheck } from "../src/desktop.ts";
import { silentLogger } from "../src/log.ts";
import { PreviewPool } from "../src/preview/pool.ts";
import { createRenderChecker, pickRenderPages, RENDER_WIDTHS } from "../src/themes/render-check.ts";
import { httpGet } from "./helpers.ts";

// The render check of theme projects (plan 14, borrowing from taste skill, D3): the server side. The page
// script runs in e2e/render-check.spec.ts; the hidden window only exists in the desktop app.

const BASE = 48870;
const PROJECT = "theme:t1" as ProjectKey;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bj-render-"));
const pools: PreviewPool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((p) => p.closeAll()));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
/** A build output laid out like Bukit's for the sample content. */
function build(files: string[]): string {
  const root = path.join(tmp, `out-${++n}`);
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), `<h1>${f}</h1>`);
  }
  return root;
}

const SAMPLE = [
  "index.html",
  "blog/index.html",
  "blog/page/2/index.html",
  "blog/2026/01/first-post/index.html",
  "tags/news/index.html",
  "pages/style-guide/index.html",
  "pages/about/index.html",
  "404.html",
];

describe("pickRenderPages", () => {
  it("picks the home page, a list with more pages, a post and the style guide", () => {
    expect(pickRenderPages(build(SAMPLE))).toEqual(["", "blog/", "blog/2026/01/first-post/", "pages/style-guide/"]);
  });

  it("picks what there is", () => {
    expect(pickRenderPages(build(["index.html", "about/index.html"]))).toEqual([""]);
    expect(pickRenderPages(build(["en/index.html"]))).toEqual([]);
  });
});

function pool() {
  const p = new PreviewPool(BASE, new Set(), silentLogger);
  pools.push(p);
  return p;
}

/** A fake desktop app: records the URLs and fetches each page before answering, as the real one loads it. */
function fakeDesktop(answer: (urls: string[], widths: number[]) => { pages: unknown; error: string | null }) {
  const seen: { urls: string[]; widths: number[]; bodies: string[] }[] = [];
  const request = async (urls: string[], widths: number[]) => {
    const bodies: string[] = [];
    for (const url of urls) {
      const u = new URL(url);
      bodies.push((await httpGet(Number(u.port), { path: u.pathname })).body);
    }
    seen.push({ urls, widths, bodies });
    return answer(urls, widths);
  };
  return { seen, request };
}

const clean = (urls: string[], widths: number[]) => ({
  pages: urls.map((url) => ({ url, results: widths.map((width) => ({ width, issues: [] })) })),
  error: null,
});

describe("createRenderChecker", () => {
  it("serves the build on a port of its own, checks the pages at four widths and closes the port", async () => {
    const previews = pool();
    const desktop = fakeDesktop(clean);
    const check = createRenderChecker({ previews, request: desktop.request });
    const root = build(SAMPLE);
    const outcome = await check({ project: PROJECT, root, basePath: "/" });
    expect(outcome).toEqual({
      ok: true,
      pages: ["/", "/blog/", "/blog/2026/01/first-post/", "/pages/style-guide/"].map((page) => ({
        page,
        widths: RENDER_WIDTHS,
      })),
      issues: [],
      notes: [],
    });
    const [call] = desktop.seen;
    expect(call?.widths).toEqual(RENDER_WIDTHS);
    expect(call?.bodies).toEqual([
      "<h1>index.html</h1>",
      "<h1>blog/index.html</h1>",
      "<h1>blog/2026/01/first-post/index.html</h1>",
      "<h1>pages/style-guide/index.html</h1>",
    ]);
    const port = Number(new URL(call?.urls[0] as string).port);
    await expect(httpGet(port)).rejects.toThrow();
  });

  it("serves under the base path and checks the pages asked for", async () => {
    const desktop = fakeDesktop(clean);
    const check = createRenderChecker({ previews: pool(), request: desktop.request });
    const outcome = await check({
      project: PROJECT,
      root: build(SAMPLE),
      basePath: "/docs/",
      pages: ["/pages/about/"],
    });
    expect(outcome.ok && outcome.pages).toEqual([{ page: "/pages/about/", widths: RENDER_WIDTHS }]);
    expect(desktop.seen[0]?.urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/docs\/pages\/about\/$/);
    expect(desktop.seen[0]?.bodies).toEqual(["<h1>pages/about/index.html</h1>"]);
  });

  it("refuses pages outside the build without asking the desktop app", async () => {
    const desktop = fakeDesktop(clean);
    const check = createRenderChecker({ previews: pool(), request: desktop.request });
    const root = build(SAMPLE);
    for (const page of ["../secret/", "blog/../../x", "nope/"]) {
      expect(await check({ project: PROJECT, root, basePath: "/", pages: [page] })).toEqual({
        ok: false,
        error: `Not a page of the build: ${page}`,
      });
    }
    expect(await check({ project: PROJECT, root: build(["en/index.html"]), basePath: "/" })).toEqual({
      ok: false,
      error: "The build has no pages to check.",
    });
    expect(desktop.seen).toEqual([]);
  });

  it("lists each finding once with its widths, drops unknown rules and notes a width that differs", async () => {
    const overflow = { rule: "overflow", element: "div.wide", detail: "Ends at 600px." };
    const desktop = fakeDesktop((urls) => ({
      pages: [
        {
          url: urls[0],
          results: [
            { width: 320, issues: [overflow, { rule: "made_up", element: "x", detail: "y" }] },
            { width: 390, issues: [overflow] },
            { width: 768, issues: [] },
            { width: 1200, issues: [{ rule: "headings", element: "body", detail: "No h1." }] },
          ],
        },
      ],
      error: null,
    }));
    const check = createRenderChecker({ previews: pool(), request: desktop.request });
    const outcome = await check({ project: PROJECT, root: build(SAMPLE), basePath: "/", pages: [""] });
    expect(outcome).toEqual({
      ok: true,
      pages: [{ page: "/", widths: [320, 390, 768, 1200] }],
      issues: [
        { page: "/", ...overflow, widths: [320, 390] },
        { page: "/", rule: "headings", element: "body", detail: "No h1.", widths: [1200] },
      ],
      notes: ["/ was checked 1200px wide instead of 1280px (the window could not be that size)."],
    });
  });

  it("lists at most 40 findings and says how many more there are", async () => {
    const desktop = fakeDesktop((urls) => ({
      pages: [
        {
          url: urls[0],
          results: [
            {
              width: 320,
              issues: Array.from({ length: 45 }, (_, i) => ({ rule: "overlap", element: `p${i}`, detail: "x" })),
            },
          ],
        },
      ],
      error: null,
    }));
    const check = createRenderChecker({ previews: pool(), request: desktop.request });
    const outcome = await check({ project: PROJECT, root: build(SAMPLE), basePath: "/", pages: [""] });
    expect(outcome.ok && outcome.issues).toHaveLength(40);
    expect(outcome.ok && outcome.notes).toEqual(["5 more issues are not listed; fix these and check again."]);
  });

  it("stops waiting when the run is stopped, and closes the port", async () => {
    const controller = new AbortController();
    let port = 0;
    const check = createRenderChecker({
      previews: pool(),
      request: (urls) => {
        port = Number(new URL(urls[0] as string).port);
        controller.abort();
        return new Promise(() => {});
      },
    });
    const outcome = await check({
      project: PROJECT,
      root: build(SAMPLE),
      basePath: "/",
      pages: [""],
      signal: controller.signal,
    });
    expect(outcome).toEqual({ ok: false, error: "The check was stopped." });
    await expect(httpGet(port)).rejects.toThrow();
  });

  it("passes on the desktop app's error and closes the port", async () => {
    const desktop = fakeDesktop(() => ({ pages: null, error: "timeout" }));
    const check = createRenderChecker({ previews: pool(), request: desktop.request });
    expect(await check({ project: PROJECT, root: build(SAMPLE), basePath: "/", pages: [""] })).toEqual({
      ok: false,
      error: "The desktop app could not check the pages: timeout",
    });
    const port = Number(new URL(desktop.seen[0]?.urls[0] as string).port);
    await expect(httpGet(port)).rejects.toThrow();
    const broken = fakeDesktop(() => ({ pages: "nonsense", error: null }));
    const again = createRenderChecker({ previews: pool(), request: broken.request });
    expect(await again({ project: PROJECT, root: build(SAMPLE), basePath: "/", pages: [""] })).toEqual({
      ok: false,
      error: "The desktop app returned no result.",
    });
  });
});

/** A channel that answers like the desktop app, or not at all. */
function channel(reply: ((id: number) => DesktopInbound | null) | "throw"): DesktopChannel {
  let handler: (m: DesktopInbound) => void = () => {};
  return {
    send(message) {
      if (reply === "throw") throw new Error("channel closed");
      if (message.type !== "render-check") return;
      const answer = reply(message.id);
      if (answer) setImmediate(() => handler(answer));
    },
    onMessage: (h) => {
      handler = h;
    },
    onClose: () => {},
  };
}

describe("requestRenderCheck", () => {
  it("returns the pages of the reply with the request's id", async () => {
    const pages = [{ url: "http://127.0.0.1:1/", results: [] }];
    const c = channel((id) => ({ type: "render-check-result", id, pages, error: null }));
    expect(await requestRenderCheck(c, ["http://127.0.0.1:1/"], [320])).toEqual({ pages, error: null });
  });

  it("returns the error of the reply, a timeout, or the send failure", async () => {
    const failed = channel((id) => ({ type: "render-check-result", id, pages: null, error: "no window" }));
    expect(await requestRenderCheck(failed, ["u"], [320])).toEqual({ pages: null, error: "no window" });
    expect(
      await requestRenderCheck(
        channel(() => null),
        ["u"],
        [320],
        20,
      ),
    ).toEqual({ pages: null, error: "timeout" });
    expect(await requestRenderCheck(channel("throw"), ["u"], [320])).toEqual({ pages: null, error: "channel closed" });
  });
});
