import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";

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

function environment(home: string, profile: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BUKITJALIL_HOME: home,
    BUKITJALIL_DESKTOP_PROFILE: profile,
    BUKITJALIL_DESKTOP_PORT: String(PORT),
  };
}

async function launch(home = fs.mkdtempSync(path.join(os.tmpdir(), "bj-desk-home-"))): Promise<Run> {
  const env = environment(home, fs.mkdtempSync(path.join(os.tmpdir(), "bj-desk-profile-")));
  const app = await _electron.launch({
    executablePath: electronBin,
    args: [desktopDir],
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
  expect(new URL(page.url()).origin).toBe(`http://127.0.0.1:${PORT}`);
  expect(await page.evaluate(() => [typeof (window as { require?: unknown }).require, typeof process])).toEqual([
    "undefined",
    "undefined",
  ]);
  expect(
    await page.evaluate(() => Object.keys((window as unknown as { bukitjalil: object }).bukitjalil).sort()),
  ).toEqual(["desktop", "pickFolder", "restart"]);
  // The server holds the data directory while the app runs and gives it back on quit.
  const pid = Number(fs.readFileSync(lockFile(home), "utf8"));
  expect(pid).toBeGreaterThan(0);
  await app.close();
  expect(fs.existsSync(lockFile(home))).toBe(false);
  expect(() => process.kill(pid, 0)).toThrow();
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
  const second = spawn(electronBin, [desktopDir], { env: run.env, stdio: "ignore" });
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
