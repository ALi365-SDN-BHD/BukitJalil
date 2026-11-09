import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { silentLogger } from "../packages/server/src/log.ts";
import { PreviewPool } from "../packages/server/src/preview/pool.ts";
import { expect, test } from "./fixtures.ts";
import { ADMIN, E2E_ADMIN_PORT } from "./ports.ts";

// The M1 spike (packages/server/spikes/preview-isolation-browsers.mjs) as a regression test against the
// real admin server: an AI-written preview page tries to change settings and to frame the admin UI.

const EVIL = `<!doctype html><meta charset=utf-8><title>evil</title>
<form id=f method=POST action="${ADMIN}/api/settings" enctype="text/plain"><input name='{"lastParentDir":"/pwned","x":"' value='"}'></form>
<img src="${ADMIN}/api/settings?via=img" alt="">
<iframe id=admin src="${ADMIN}/" width=300 height=100></iframe>
<script>
const log = (m) => console.log("[evil] " + m);
(async () => {
  log("origin " + self.origin);
  const body = JSON.stringify({ lastParentDir: "/pwned" });
  const attempts = [
    ["fetch json+header", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json", "X-BukitJalil": "1" }, body }],
    ["fetch no-cors", { method: "PUT", mode: "no-cors", credentials: "include", headers: { "Content-Type": "text/plain" }, body }],
  ];
  for (const [name, init] of attempts) {
    try { const r = await fetch("${ADMIN}/api/settings", init); log(name + " status " + r.status); } catch (e) { log(name + " blocked"); }
  }
  try { navigator.sendBeacon("${ADMIN}/api/settings", body); log("beacon called"); } catch { log("beacon blocked"); }
  try { document.getElementById("f").submit(); log("form called"); } catch { log("form blocked"); }
  setTimeout(() => log("done"), 1500);
})();
</script>`;

let pool: PreviewPool;
let previewUrl: string;

test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bj-e2e-evil-"));
  fs.writeFileSync(path.join(dir, "index.html"), EVIL);
  pool = new PreviewPool(E2E_ADMIN_PORT + 11, new Set([E2E_ADMIN_PORT]), silentLogger);
  previewUrl = (await pool.open("evil:change", dir)).url;
});

test.afterAll(async () => {
  await pool.closeAll();
});

async function login(page: Page, url: string) {
  await page.goto(url);
  await page.evaluate(async () => {
    // Reset through the real UI path (same origin, all headers).
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-BukitJalil": "1" },
      body: JSON.stringify({ lastParentDir: null }),
    });
  });
}

const readSettings = (page: Page) =>
  page.evaluate(async () => (await fetch("/api/settings")).json() as Promise<{ lastParentDir: string | null }>);

function waitForEvilDone(page: Page) {
  const lines: string[] = [];
  const done = new Promise<string[]>((resolve) => {
    page.on("console", (msg) => {
      const text = msg.text();
      if (!text.startsWith("[evil] ")) return;
      lines.push(text);
      if (text === "[evil] done") resolve(lines);
    });
  });
  return Promise.race([done, new Promise<string[]>((r) => setTimeout(() => r(lines), 10_000))]);
}

test("preview inside the admin iframe cannot change settings or frame the admin UI", async ({ page, server }) => {
  await login(page, await server.loginUrl());
  const adminFrameResponses: number[] = [];
  page.on("response", (res) => {
    if (res.url() === `${ADMIN}/` && res.request().frame() !== page.mainFrame()) adminFrameResponses.push(res.status());
  });
  const logs = waitForEvilDone(page);
  await page.evaluate((src) => {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts");
    f.src = src;
    document.body.append(f);
  }, previewUrl);
  const lines = await logs;
  expect(lines).toContain("[evil] origin null");
  expect(lines).toContain("[evil] done");
  expect(lines.some((l) => /status 2\d\d/.test(l))).toBe(false);
  expect((await readSettings(page)).lastParentDir).toBeNull();

  // The admin page was requested inside the preview but must not render there.
  const evilFrame = page.frames().find((f) => f.url() === previewUrl);
  expect(evilFrame).toBeTruthy();
  for (const child of evilFrame?.childFrames() ?? []) {
    // Firefox never answers evaluate() in a frame it refused to render, so time out instead.
    const title = await Promise.race([
      child.evaluate(() => document.title).catch(() => "(blocked)"),
      new Promise<string>((r) => setTimeout(() => r("(no answer)"), 2_000)),
    ]);
    expect(title).not.toBe("BukitJalil");
  }
  expect(adminFrameResponses.length).toBeGreaterThan(0);
});

test("preview opened directly cannot change settings", async ({ page, context, server }) => {
  await login(page, await server.loginUrl());
  const top = await context.newPage();
  const logs = waitForEvilDone(top);
  await top.goto(previewUrl);
  const lines = await logs;
  expect(lines).toContain("[evil] done");
  expect(lines.some((l) => /status 2\d\d/.test(l))).toBe(false);
  expect((await readSettings(page)).lastParentDir).toBeNull();
});
