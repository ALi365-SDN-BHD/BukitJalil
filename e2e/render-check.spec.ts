import { expect, type Page, test } from "@playwright/test";
import { type RenderIssue, type RenderRule, renderCheckPage } from "../packages/desktop/src/render-check-page.ts";

// The page script of the desktop render check (plan 14, borrowing from taste skill, D3), on fixed pages in
// each browser. The desktop app runs the same function in Electron's Chromium.

const BASE = `<style>
  body { margin: 0; font: 16px/1.5 sans-serif; }
  a:focus-visible, button:focus-visible { outline: 2px solid #1d5a8c; }
  nav a { display: inline-block; padding: 12px; min-height: 44px; }
</style>`;

async function check(page: Page, width: number, body: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(`<!doctype html><html><head>${BASE}</head><body>${body}</body></html>`);
  return page.evaluate(renderCheckPage, { maxPerRule: 5 });
}

const rules = (issues: RenderIssue[], rule: RenderRule) => issues.filter((i) => i.rule === rule);

const GOOD = `<header><nav><a href="/">Home</a><a href="/blog/">Blog</a></nav></header>
<main><h1>Title</h1><h2>Part</h2><p>Text with <a href="/x">a link</a> in it.</p>
<pre style="overflow-x:auto"><code>${"x".repeat(400)}</code></pre></main>
<footer><a href="/about/" style="display:inline-block;padding:12px">About</a></footer>`;

test("a well-made page has no issues at 320 and 1280", async ({ page }) => {
  for (const width of [320, 1280]) {
    const result = await check(page, width, GOOD);
    expect(result.width).toBe(width);
    expect(result.issues).toEqual([]);
  }
});

test("names what makes the page scroll sideways, not a code block that scrolls inside", async ({ page }) => {
  const result = await check(page, 320, `<main><h1>T</h1><div class="wide" style="width:600px">Wide</div></main>`);
  expect(rules(result.issues, "overflow")).toEqual([expect.objectContaining({ element: 'div.wide "Wide"' })]);
});

test("reports small tap targets close together, not links in running text", async ({ page }) => {
  const small = `<main><h1>T</h1><nav class="tiny"><a href="/a" style="font-size:12px">A</a><a href="/b" style="font-size:12px">B</a></nav>
<p>See <a href="/c">this</a> and <a href="/d">that</a>.</p></main>`;
  const result = await check(page, 1280, small);
  expect(rules(result.issues, "tap_target").map((i) => i.element)).toEqual(['a "A"', 'a "B"']);
});

test("leaves a visually hidden skip link out of the tap targets", async ({ page }) => {
  const result = await check(
    page,
    1280,
    `<style>.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }</style>
<a class="visually-hidden" href="#main">Skip</a><header><a href="/" style="display:inline-block;padding:10px">Logo</a></header>
<main id="main"><h1>T</h1></main>`,
  );
  expect(rules(result.issues, "tap_target")).toEqual([]);
});

test("reports a page without one h1 and a skipped heading level", async ({ page }) => {
  const result = await check(page, 1280, `<main><h1>A</h1><h1>B</h1><h4>Deep</h4></main>`);
  expect(rules(result.issues, "headings").map((i) => i.detail)).toEqual([
    "The page has 2 visible h1 headings; it needs one.",
    "Jumps from h1 to h4.",
  ]);
});

test("reports a link that shows nothing when focused, and not one with a focus ring", async ({ page, browserName }) => {
  // WebKit ignores focusVisible on programmatic focus, so :focus-visible does not match there.
  test.skip(browserName === "webkit", "WebKit does not support focus({ focusVisible: true })");
  const result = await check(
    page,
    1280,
    `<style>.bare:focus { outline: none; }</style><main><h1>T</h1>
<p><a class="bare" href="/a" style="display:inline-block;padding:14px">Bare</a></p>
<p><a href="/b" style="display:inline-block;padding:14px">Ringed</a></p></main>`,
  );
  expect(rules(result.issues, "focus_ring").map((i) => i.element)).toEqual(['a.bare "Bare"']);
});

test("reports blocks that lie on one another", async ({ page }) => {
  const result = await check(
    page,
    1280,
    `<main><h1 style="height:60px">Title</h1><p class="up" style="margin-top:-40px">Pulled up</p></main>`,
  );
  expect(rules(result.issues, "overlap")).toEqual([
    expect.objectContaining({ element: 'h1 "Title"', detail: expect.stringContaining('p.up "Pulled up"') }),
  ]);
});

test("caps each rule and says how many more there are", async ({ page }) => {
  const result = await check(page, 1280, `<main>${"<h1>x</h1><h4>y</h4>".repeat(8)}</main>`);
  const headings = rules(result.issues, "headings");
  expect(headings).toHaveLength(6);
  expect(headings.at(-1)?.detail).toMatch(/^\d+ more not listed\.$/);
});
