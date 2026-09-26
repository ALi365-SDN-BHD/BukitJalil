import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("global settings save locally, reject invalid paths, show live models, and reopen without model turns", async ({}, info) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bukitjalil-settings-gui-")));
  const data = path.join(root, "app"), codex = path.join(root, "codex"), bukit = path.join(root, "bukit");
  await fs.mkdir(data);
  for (const [fixture, target] of [["fake-codex.cjs", codex], ["fake-bukit.cjs", bukit]]) {
    await fs.copyFile(new URL("./fixtures/" + fixture, import.meta.url), target); await fs.chmod(target, 0o700);
  }
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), BUKITJALIL_DATA_DIR: data, BUKITJALIL_CODEX_BIN: codex, BUKIT_BIN: bukit };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  let page!: Page;
  const launch = async () => {
    app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
    page = await app.firstWindow(); await page.waitForURL("bukitjalil://app/index.html");
    await page.getByRole("button", { name: "全局设置" }).click();
    await expect(page.getByRole("main", { name: "全局设置" })).toBeVisible();
  };
  try {
    await launch();
    await expect(page.getByText("bukit 2.0.0-test")).toBeVisible();
    await expect(page.getByRole("main", { name: "全局设置" }).getByText("codex-cli 0.155.0-test")).toBeVisible();
    await page.getByLabel("可执行文件路径").first().fill(path.join(root, "missing"));
    await page.getByRole("button", { name: "保存 Bukit 路径" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect((await page.evaluate(() => window.desktop.state())).binary).toBe(bukit);
    await page.getByLabel("可执行文件路径").first().fill(bukit);
    await page.getByLabel("可执行文件路径").nth(1).fill(path.join(root, "missing-codex"));
    await page.getByRole("button", { name: "保存 Codex 路径" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect((await page.evaluate(() => window.desktop.chatState())).binary).toBe(codex);
    await page.getByLabel("可执行文件路径").nth(1).fill(codex);
    await page.getByRole("button", { name: "检测连接" }).click();
    await expect(page.getByText("ChatGPT 已登录 · plus")).toBeVisible();
    await expect(page.getByRole("option", { name: "Synthetic Sol" })).toHaveCount(1);
    await page.locator("#settings-model").selectOption("synthetic-sol");
    await page.locator("#settings-effort").selectOption("high");
    await page.getByRole("button", { name: "保存模型偏好" }).click();
    await expect(page.getByRole("status")).toContainText("模型偏好已保存");
    expect(JSON.parse(await fs.readFile(path.join(data, "codex-settings.json"), "utf8"))).toMatchObject({ model: "synthetic-sol", effort: "high" });
    const screenshot = process.env.BUKITJALIL_SETTINGS_SCREENSHOT ?? info.outputPath("global-settings.png");
    await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>(".app-shell")!;
      const settings = document.querySelector<HTMLElement>(".settings-page")!;
      shell.style.height = "auto"; shell.style.minHeight = "100vh"; shell.style.overflow = "visible";
      settings.style.overflow = "visible"; settings.scrollTop = 0;
    });
    await page.screenshot({ path: screenshot, fullPage: true });
    await page.getByRole("button", { name: /项目首页/ }).click();
    await expect(page.getByRole("main", { name: "项目首页" })).toBeVisible();
    await app!.close(); app = undefined;
    await launch();
    await page.getByRole("button", { name: "检测连接" }).click();
    await expect(page.locator("#settings-model")).toHaveValue("synthetic-sol");
    await expect(page.locator("#settings-effort")).toHaveValue("high");
    const requests = await fs.readFile(path.join(root, "requests.jsonl"), "utf8");
    expect(requests).not.toContain('"turn/start"');
  } finally { await app?.close(); await fs.rm(root, { recursive: true, force: true }); }
});
