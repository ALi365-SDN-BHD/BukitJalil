import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("generation UI: real copy diff, reject, confirm, build and reopen with synthetic Codex", async ({}, info) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bukitjalil-generation-gui-")));
  const site = path.join(root, "site"), codex = path.join(root, "codex"), fakeBukit = path.join(root, "bukit");
  for (const [name, to] of [["fake-codex.cjs", codex], ["fake-bukit.cjs", fakeBukit]]) {
    await fs.copyFile(new URL("./fixtures/" + name, import.meta.url), to); await fs.chmod(to, 0o700);
  }
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), BUKITJALIL_CODEX_BIN: codex, BUKIT_BIN: process.env.BUKIT_BIN || fakeBukit, BUKITJALIL_DATA_DIR: path.join(root, "app") };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  const launch = async () => {
    app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
    const page = await app.firstWindow(); await page.waitForURL("bukitjalil://app/index.html"); return page;
  };
  try {
    let page = await launch();
    await app!.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, site);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByLabel("项目名称", { exact: true }).fill("AI 副本工作室");
    await page.getByRole("button", { name: "选择位置并创建" }).click();
    await page.getByRole("button", { name: "应用样例主题" }).click();
    await expect(page.getByRole("button", { name: "✓ 已应用独立副本" })).toBeVisible();
    const baseline = await fs.readFile(path.join(site, "bukitjalil.json"), "utf8");
    await page.getByRole("tab", { name: "对话", exact: true }).click();
    await page.getByRole("button", { name: "连接 Codex", exact: true }).click();
    await expect(page.getByText("Codex · ChatGPT 已登录")).toBeVisible();
    const generate = async () => {
      await page.getByLabel("讨论你的网站", { exact: true }).fill("生成一个新首页和故事页，删除关于页");
      await page.getByRole("button", { name: "生成修改 · 先审核副本" }).click();
      await expect(page.getByRole("button", { name: "审核 4 个文件差异" })).toBeVisible();
      await expect(page.getByRole("button", { name: "返回项目首页" })).toBeDisabled();
      expect(await page.evaluate(async () => {
        try { await window.desktop.home(); return "allowed"; } catch { return "denied"; }
      })).toBe("denied");
      await page.getByRole("button", { name: "审核 4 个文件差异" }).click();
      await expect(page.getByRole("dialog", { name: "审核生成修改" })).toBeVisible();
      await expect(page.getByText("新增 · content/story.md", { exact: true })).toBeVisible();
      await expect(page.getByText("删除 · content/about.md", { exact: true })).toBeVisible();
      await page.getByText("修改 · site.yaml", { exact: true }).click();
      await expect(page.getByRole("dialog").getByText(/title: "来自 AI 的新首页"/)).toBeVisible();
      expect(await fs.readFile(path.join(site, "bukitjalil.json"), "utf8")).toBe(baseline);
    };
    await generate();
    await page.screenshot({ path: info.outputPath("generation-review.png") });
    await page.getByRole("button", { name: "拒绝修改", exact: true }).click();
    await expect(page.getByText("已拒绝修改", { exact: true })).toBeVisible();
    expect(await fs.readFile(path.join(site, "bukitjalil.json"), "utf8")).toBe(baseline);
    await generate();
    await page.getByRole("button", { name: "确认应用并构建", exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.desktop.state())).project?.lastBuild?.status).toBe("success");
    await expect(page.frameLocator("iframe").locator("h1")).toHaveText("来自 AI 的新首页");
    await expect(page.getByRole("button", { name: /新故事 \/story/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /关于 \/about/ })).toHaveCount(0);
    if (process.env.BUKIT_BIN) {
      await page.getByRole("button", { name: /新故事 \/story/ }).click();
      await expect(page.frameLocator("iframe").locator("article")).toContainText("生成副本中的新页面");
    }
    await page.screenshot({ path: info.outputPath("generation-applied.png") });
    const current = (await page.evaluate(() => window.desktop.state())).project!.currentRevisionId;
    await app!.close(); app = undefined;
    page = await launch();
    await expect(page.getByRole("main", { name: "项目首页" })).toBeVisible();
    await page.getByRole("button", { name: "打开项目 AI 副本工作室", exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.desktop.state())).preview?.revisionId).toBe(current);
    await expect(page.frameLocator("iframe").locator("h1")).toHaveText("来自 AI 的新首页");
    expect((await page.evaluate(() => window.desktop.state())).generation).toBeNull();
    const requests = (await fs.readFile(path.join(root, "requests.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(requests.filter((r) => r.method === "turn/start")).toHaveLength(2);
  } finally { await app?.close(); await fs.rm(root, { recursive: true, force: true }); }
});
