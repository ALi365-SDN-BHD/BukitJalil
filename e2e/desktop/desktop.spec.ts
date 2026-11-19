import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { tinyPng } from "../../packages/server/test/fixtures/images.ts";
import { putSettings } from "../site-helpers.ts";

const root = path.resolve(import.meta.dirname, "../..");
const desktopDir = path.join(root, "packages/desktop");
// The electron package's main export is the path of its binary.
const electronBin = createRequire(path.join(desktopDir, "package.json"))("electron") as unknown as string;
const PORT = 49800;

interface Run {
  app: ElectronApplication;
  page: Page;
  home: string;
  env: NodeJS.ProcessEnv;
}

const MOCK_KEYCHAIN = process.platform === "darwin" ? ["--use-mock-keychain"] : [];

function environment(home: string, profile: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // The development app finds Bukit in vendor/ (pnpm fetch:bukit); CI fetches it elsewhere and sets BUKIT_BIN.
    ...(process.env.BUKIT_BIN && !process.env.BUKITJALIL_BUKIT_DIR
      ? { BUKITJALIL_BUKIT_DIR: path.dirname(process.env.BUKIT_BIN) }
      : {}),
    BUKITJALIL_HOME: home,
    BUKITJALIL_DESKTOP_PROFILE: profile,
    BUKITJALIL_DESKTOP_PORT: String(PORT),
  };
}

async function launch(
  home = fs.mkdtempSync(path.join(os.tmpdir(), "bj-desk-home-")),
  extraEnv: Record<string, string> = {},
): Promise<Run> {
  const env = {
    ...environment(home, fs.mkdtempSync(path.join(os.tmpdir(), "bj-desk-profile-"))),
    ...extraEnv,
  };
  const app = await _electron.launch({
    executablePath: electronBin,
    // Chromium's stand-in keychain: tests never touch the user's real one (plan 6.7).
    args: [...MOCK_KEYCHAIN, desktopDir],
    env: env as Record<string, string>,
  });
  const page = await app.firstWindow();
  return { app, page, home, env };
}

const lockFile = (home: string) => path.join(home, "server.lock");
const sleepers: ChildProcess[] = [];
test.afterEach(() => {
  for (const s of sleepers.splice(0)) s.kill();
});

test("opens the app signed in, with only the desktop bridge exposed", async () => {
  const { app, page, home } = await launch();
  await expect(page.getByTestId("new-site")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("app-update")).toBeVisible();
  expect(new URL(page.url()).origin).toBe(`http://127.0.0.1:${PORT}`);
  expect(await page.evaluate(() => [typeof (window as { require?: unknown }).require, typeof process])).toEqual([
    "undefined",
    "undefined",
  ]);
  expect(
    await page.evaluate(() => Object.keys((window as unknown as { bukitjalil: object }).bukitjalil).sort()),
  ).toEqual([
    "capturePreflight",
    "desktop",
    "onCaptureProgress",
    "pickFile",
    "pickFolder",
    "platform",
    "restart",
    "saveFile",
    "setLocale",
    "startCapture",
  ]);
  // The server holds the data directory while the app runs and gives it back on quit.
  const pid = Number(fs.readFileSync(lockFile(home), "utf8"));
  expect(pid).toBeGreaterThan(0);
  await app.close();
  expect(fs.existsSync(lockFile(home))).toBe(false);
  expect(() => process.kill(pid, 0)).toThrow();
});

test("the menus and the About panel follow the language chosen in settings", async () => {
  const { app, page } = await launch();
  await expect(page.getByTestId("slogan")).toBeVisible({ timeout: 30_000 });
  const helpLabels = () =>
    app.evaluate(({ Menu }) =>
      (Menu.getApplicationMenu()?.items.at(-1)?.submenu?.items ?? []).map((item) => item.label),
    );
  for (const [locale, label, slogan] of [
    ["en", "Open Logs Folder", "Every note deserves to be seen"],
    ["zh-CN", "打开日志目录", "每一次笔记，都值得被看见"],
  ] as const) {
    await page.evaluate(
      (value) =>
        fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-bukitjalil": "1" },
          body: JSON.stringify({ locale: value }),
        }),
      locale,
    );
    await page.reload();
    await expect(page.getByTestId("slogan")).toContainText(slogan);
    await expect.poll(helpLabels).toContain(label);
  }
  await app.close();
});

test("keeps tokens encrypted with a key the keychain protects", async () => {
  const { app, page, home } = await launch();
  await expect(page.getByTestId("new-site")).toBeVisible({ timeout: 30_000 });
  // The app asks the keychain once its window shows the app; the key file is made at the first start and
  // the settings show nothing while secrets are encrypted.
  const status = () => page.evaluate(async () => (await fetch("/api/secrets")).json());
  await expect.poll(status).toEqual({ mode: "encrypted", reason: null, plainFiles: false });
  expect(fs.existsSync(path.join(home, "secret-key.enc"))).toBe(true);
  await app.close();
  // A plain token file from an earlier version is encrypted at the next start and removed.
  fs.writeFileSync(path.join(home, "publish-account-tokens.json"), JSON.stringify({}), { mode: 0o600 });
  const again = await launch(home);
  await expect(again.page.getByTestId("new-site")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => fs.existsSync(path.join(home, "publish-account-tokens.json"))).toBe(false);
  expect(fs.existsSync(path.join(home, "publish-account-tokens.enc.json"))).toBe(true);
  await again.app.close();
});

test("sends web links to the system browser and keeps the window on the app", async () => {
  const { app, page } = await launch();
  await expect(page.getByTestId("new-site")).toBeVisible({ timeout: 30_000 });
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { opened?: string[] }).opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  const origin = new URL(page.url()).origin;
  await page.evaluate(() => {
    window.open("https://example.com/new-window");
    window.open("file:///etc/hosts");
  });
  await page.evaluate(() => {
    location.href = "https://example.com/navigate";
  });
  await page.waitForTimeout(500);
  expect(new URL(page.url()).origin).toBe(origin);
  expect(await app.evaluate(() => (globalThis as { opened?: string[] }).opened)).toEqual([
    "https://example.com/new-window",
    "https://example.com/navigate",
  ]);
  expect(app.windows()).toHaveLength(1);
  // No page gets device or notification permissions.
  expect(await page.evaluate(() => Notification.requestPermission())).toBe("denied");
  await app.close();
});

test("a second launch hands over to the running app and exits", async () => {
  const run = await launch();
  await expect(run.page.getByTestId("new-site")).toBeVisible({ timeout: 30_000 });
  const second = spawn(electronBin, [...MOCK_KEYCHAIN, desktopDir], { env: run.env, stdio: "ignore" });
  const code = await new Promise<number | null>((resolve) => second.once("exit", resolve));
  expect(code).toBe(0);
  expect(run.app.windows()).toHaveLength(1);
  await run.app.close();
});

test("explains when the server stops and starts it again on request", async () => {
  const { app, page, home } = await launch();
  await expect(page.getByTestId("new-site")).toBeVisible({ timeout: 30_000 });
  process.kill(Number(fs.readFileSync(lockFile(home), "utf8")), "SIGKILL");
  await expect(page.locator("#title")).toHaveText(/stopped unexpectedly|意外停止/);
  await page.getByRole("button", { name: /Start again|重新启动/ }).click();
  await expect(page.getByTestId("new-site")).toBeVisible({ timeout: 30_000 });
  await app.close();
});

test("says when another BukitJalil holds the data directory", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bj-desk-home-"));
  const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  sleepers.push(sleeper);
  fs.writeFileSync(lockFile(home), `${sleeper.pid}\n`);
  const { app, page } = await launch(home);
  await expect(page.locator("#text")).toContainText(/same data directory|同一个数据目录/, { timeout: 30_000 });
  sleeper.kill();
  await new Promise((r) => sleeper.once("exit", r));
  await page.getByRole("button", { name: /Start again|重新启动/ }).click();
  await expect(page.getByTestId("new-site")).toBeVisible({ timeout: 30_000 });
  await app.close();
});

test("uploads a dropped file and previews it in the desktop app", async () => {
  test.setTimeout(120_000);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bj-desk-media-"));
  const { app, page } = await launch(home, {
    HOME: home,
    USERPROFILE: home,
    BUKITJALIL_HOME: path.join(home, ".bukitjalil"),
  });
  try {
    await expect(page.getByTestId("new-site")).toBeVisible({ timeout: 30_000 });
    const site = await page.evaluate(
      async ({ dir }) => {
        const headers = { "content-type": "application/json", "x-bukitjalil": "1" };
        await fetch("/api/settings", {
          method: "PUT",
          headers,
          body: JSON.stringify({ commitName: "Desk Media", commitEmail: "desk-media@example.com" }),
        });
        const res = await fetch("/api/sites", {
          method: "POST",
          headers,
          body: JSON.stringify({ name: "Desktop media", path: dir, language: "en-US" }),
        });
        return { status: res.status, body: await res.json() };
      },
      { dir: path.join(home, "media-site") },
    );
    expect(site.status, JSON.stringify(site.body)).toBe(201);
    const siteId = (site.body as { id: string }).id;
    await page.goto(new URL(`/sites/${siteId}`, page.url()).toString());
    await expect(page.getByTestId("build-status").first()).toHaveText(/成功|Succeeded/, { timeout: 60_000 });

    // A real drag event reaches the shared uploader, not just the hidden file input. The preview toolbar's
    // button hands over to the changes panel, which is where the drop area lives now.
    await page.getByTestId("preview-upload").click();
    await expect(page.getByTestId("tab-changes")).toHaveAttribute("aria-selected", "true");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ).toString("base64");
    await page.getByTestId("media-upload-area").evaluate((el, data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "desktop.png", { type: "image/png" }));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, png);
    await expect(page.getByTestId("media-queue")).toContainText("desktop.png");
    await expect(page.getByTestId("media-queue")).toContainText(/已上传|Uploaded/);
    await page.getByTestId("tab-changes").click();
    await page
      .getByTestId("changes-panel")
      .getByTestId("changed-files")
      .getByText("themes/starter/static/uploads/desktop.png", { exact: true })
      .click();
    await expect(page.getByTestId("media-preview")).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("chooses folders with the system dialog, opened where the field points", async () => {
  const { app, page, home } = await launch();
  await expect(page.getByTestId("new-site")).toBeVisible({ timeout: 30_000 });
  const chosen = fs.mkdtempSync(path.join(home, "chosen-"));
  await app.evaluate(({ dialog }, folder) => {
    const calls: unknown[] = [];
    (globalThis as { dialogCalls?: unknown[] }).dialogCalls = calls;
    dialog.showOpenDialog = (async (_win: unknown, options: unknown) => {
      calls.push(options);
      return { canceled: false, filePaths: [folder] };
    }) as typeof dialog.showOpenDialog;
  }, chosen);
  await page.getByTestId("new-site").click();
  const field = page.getByTestId("dir-current");
  await expect(field).not.toHaveValue("");
  const before = await field.inputValue();
  // No folder list in the desktop app: the system dialog replaces it.
  await expect(page.getByRole("list", { name: /Folders|文件夹/ })).toHaveCount(0);
  await page.getByTestId("dir-choose").click();
  // The server answers with the folder's real path (on macOS /var is /private/var).
  await expect(field).toHaveValue(fs.realpathSync(chosen));
  expect(await app.evaluate(() => (globalThis as { dialogCalls?: unknown[] }).dialogCalls)).toEqual([
    { properties: ["openDirectory", "createDirectory"], defaultPath: before },
  ]);
  await app.close();
});

/** A local site for the capture: JS-rendered content, CSS, an image, a form, an alert, robots rules. */
async function fakeSite(): Promise<{ origin: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.end("User-agent: *\nDisallow: /private/\n");
      return;
    }
    if (req.url === "/style.css") {
      res.setHeader("content-type", "text/css");
      res.end("body { background: #fafafa url(/bg.png) } .card { border: 1px solid #ccc }");
      return;
    }
    if (req.url === "/logo.png" || req.url === "/bg.png") {
      res.setHeader("content-type", "image/png");
      res.end(tinyPng());
      return;
    }
    if (req.url === "/private/secret") {
      res.end("not captured");
      return;
    }
    const article = req.url === "/article/";
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><head><title>${article ? "Clone Article" : "Clone Home"}</title>
      <link rel="stylesheet" href="/style.css"></head><body>
      <header><h1>${article ? "An article" : "Home"}</h1></header>
      <div id="app"></div>
      <img src="/logo.png" width="80" height="80">
      <img src="http://10.0.0.1/blocked.png">
      <iframe src="/frame"></iframe>
      <form action="/submit"><input name="x"></form>
      <script>document.getElementById("app").innerHTML = '<p class="card">Rendered by script</p>'; alert("hello");</script>
      </body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no site port");
  return { origin: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}

test("clones the user's site into a theme through a locked-down capture", async () => {
  test.setTimeout(180_000);
  const site = await fakeSite();
  const run = await launch(undefined, { BUKITJALIL_CAPTURE_ALLOW_LOOPBACK: "1" });
  const { app, page, home } = run;
  try {
    await expect(page.getByTestId("new-site")).toBeVisible({ timeout: 30_000 });
    await putSettings(page, { commitName: "E2E Tester", commitEmail: "e2e@example.com", locale: "en" });
    await page.reload();
    await expect(page.getByTestId("new-site")).toBeVisible();

    // Private addresses are refused before anything is captured.
    expect(await page.evaluate(() => (window as any).bukitjalil.capturePreflight(["http://10.0.0.1/"]))).toMatchObject({
      ok: false,
    });

    await page.getByTestId("mode-theme").click();
    await page.getByTestId("new-theme").click();
    await page.getByTestId("clone-site").click();
    await page.getByTestId("clone-homepage").fill(`${site.origin}/`);
    await page.getByTestId("clone-pages").fill(`${site.origin}/article/\n${site.origin}/private/secret`);
    await page.getByTestId("clone-authorized").check();
    await page.getByTestId("clone-images").check();
    await page.getByTestId("clone-check").click();
    await expect(page.getByTestId("clone-preflight")).toContainText("/private/secret");
    await page.getByTestId("clone-start").click();
    await expect(page.getByTestId("clone-result")).toBeVisible({ timeout: 120_000 });

    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "bj-clone-"));
    const folder = page.getByRole("dialog").getByTestId("dir-current");
    await folder.fill(parent);
    await folder.press("Enter");
    await expect(folder).toHaveValue(fs.realpathSync(parent));
    await page.getByTestId("clone-site-dialog").locator("#theme-project-name").fill("Cloned Site");
    await page.getByTestId("clone-create").click();
    await expect(page).toHaveURL(/\/themes\/[0-9a-f]+\/sessions\/[0-9a-f]+$/, { timeout: 120_000 });
    await expect(page.getByTestId("composer-input")).toHaveValue(/site-to-theme|_capture/);

    const project = fs.readdirSync(parent).find((name) => fs.existsSync(path.join(parent, name, "_capture")));
    expect(project).toBeTruthy();
    const root = path.join(parent, project as string);
    const html = fs.readFileSync(path.join(root, "_capture", "pages", "1", "index.html"), "utf8");
    expect(html).toContain("Rendered by script");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(fs.readdirSync(path.join(root, "_reference")).length).toBeGreaterThanOrEqual(3);
    const captured = fs.readdirSync(path.join(root, "_capture", "pages", "1")).filter((f) => f.endsWith(".png"));
    expect(captured.length).toBeGreaterThanOrEqual(2);
  } finally {
    site.close();
    await app.close();
  }
});
