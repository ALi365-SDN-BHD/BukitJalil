// M1 spike: run the preview isolation page in Chromium, Firefox and WebKit with Playwright.
// Covers what the in-app browser could not: the preview inside the admin iframe, cross-port
// <img> GETs (are SameSite=Strict cookies sent?), and the preview framing the admin UI.
// Run: PLAYWRIGHT_BROWSERS_PATH=<dir> node preview-isolation-browsers.mjs  (after npx playwright install)
import { chromium, firefox, webkit } from "playwright";
import { adminServer, previewServer, resetState, state } from "./preview-isolation.mjs";

const ADMIN = "http://127.0.0.1:47880";
const PREVIEW = "http://127.0.0.1:47881";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForDone(prefix, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (state.evilLog.some((m) => m === `${prefix}done`)) break;
    await sleep(100);
  }
  await sleep(1500); // let <img> and nested iframes finish
}
async function frameTitle(page, url) {
  const f = page.frames().find((fr) => fr.url() === url);
  if (!f) return "(no frame)";
  try { return await f.evaluate(() => document.title); } catch (e) { return `(blocked: ${e.message.split("\n")[0].slice(0, 60)})`; }
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`); cond ? pass++ : fail++; };
const summary = [];

for (const [name, type] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  const browser = await type.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  console.log(`\n== ${name} ${browser.version()}`);

  // 1. Admin page (sets the cookie) embedding the preview in a sandboxed iframe.
  resetState();
  await page.goto(`${ADMIN}/`);
  await waitForDone("frame: ");
  const framed = structuredClone(state);
  const adminInPreview = await frameTitle(page, `${ADMIN}/?noframe=1`);
  const guardedInPreview = await frameTitle(page, `${ADMIN}/guarded`);
  const cookieSet = (await context.cookies()).some((c) => c.name === "bj");

  // 2. The preview opened directly as a top-level page, cookie still present.
  resetState();
  const top = await context.newPage();
  await top.goto(`${PREVIEW}/evil.html`);
  await waitForDone("top: ");
  const topLevel = structuredClone(state);

  for (const [label, st] of [["in admin iframe", framed], ["top-level", topLevel]]) {
    console.log(`  -- ${label}`);
    for (const m of st.evilLog) console.log(`     log: ${m}`);
    for (const r of st.requests) console.log(`     api: ${r.method} ${r.path} cookie=${r.cookie} site=${r.site} dest=${r.dest} origin=${r.origin}`);
  }
  console.log(`  admin page inside preview: ${adminInPreview}; /guarded inside preview: ${guardedInPreview}`);

  const both = [...framed.requests, ...topLevel.requests];
  ok(`${name}: cookie was set on the admin origin`, cookieSet);
  ok(`${name}: preview script ran in the admin iframe`, framed.evilLog.some((m) => m.startsWith("frame: origin seen by script: null")), framed.evilLog[0]);
  ok(`${name}: nothing applied`, framed.applied === 0 && topLevel.applied === 0);
  ok(`${name}: no fetch / beacon reached /api (only image and frame loads)`, both.every((r) => r.dest === "image" || r.dest === "iframe" || r.dest === null && r.method === "GET"),
    both.filter((r) => r.dest !== "image" && r.dest !== "iframe").map((r) => `${r.method} ${r.path} dest=${r.dest}`).join("; "));
  ok(`${name}: /guarded (frame-ancestors 'none' + X-Frame-Options) not rendered inside the preview`, guardedInPreview !== "admin-guarded", guardedInPreview);
  summary.push({
    browser: `${name} ${browser.version()}`,
    imgCookieFramed: framed.requests.filter((r) => r.path.includes("via=img")).map((r) => r.cookie).join(","),
    imgCookieTop: topLevel.requests.filter((r) => r.path.includes("via=img")).map((r) => r.cookie).join(","),
    adminInPreview,
  });
  await browser.close();
}

console.log("\n== summary");
console.table(summary);
console.log(`\npassed: ${pass}  failed: ${fail}`);
adminServer.close(); previewServer.close();
process.exit(fail ? 1 : 0);
