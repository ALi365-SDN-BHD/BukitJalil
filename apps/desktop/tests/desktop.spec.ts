import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Project } from "../src/shared";
import { withSiteInfo } from "../src/main/site-config";

test("macOS desktop: build, isolated preview, revision, failure, restore and reopen", async ({}, info) => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bukitjalil-gui-")),
  );
  const projectDir = path.join(root, "site");
  const dataDir = path.join(root, "app");
  let app: ElectronApplication | undefined;
  let page!: Page;
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    BUKITJALIL_DATA_DIR: dataDir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  if (!env.BUKIT_BIN) {
    env.BUKIT_BIN = path.join(root, "bukit");
    await fs.copyFile(
      new URL("./fixtures/fake-bukit.cjs", import.meta.url),
      env.BUKIT_BIN,
    );
    await fs.chmod(env.BUKIT_BIN, 0o700);
  }
  async function launch() {
    app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
    app.process().stderr?.on("data", (chunk) => process.stderr.write(chunk));
    page = await app.firstWindow();
    await page.waitForURL("bukitjalil://app/index.html");
    await expect.poll(async () => (await page.evaluate(() => window.desktop.state())).binary).not.toBeNull();
    await expect(page.locator(".app-bar").getByText("Bukit 已连接")).toHaveCount(0);
    await expect(page.getByRole("main", { name: "项目首页" })).toBeVisible();
    const initial = await page.evaluate(() => window.desktop.state());
    expect(initial.project).toBeNull();
    if (initial.recent.length) await page.getByRole("button", { name: "打开项目 " + initial.recent[0].name, exact: true }).click();
    if ((await state()).project) await expect(page.locator("iframe")).toHaveCount(0);
  }
  const state = () => page.evaluate(() => window.desktop.state());
  const build = async () => {
    if (await page.getByRole("dialog", { name: "网站构建预览" }).isVisible())
      await page.getByRole("button", { name: "关闭预览" }).click();
    await page.getByRole("button", { name: "构建预览", exact: false }).click();
    await expect(page.getByRole("dialog", { name: "网站构建预览" })).toBeVisible();
    await expect
      .poll(async () => (await state()).project?.lastBuild?.status)
      .toBe("success");
    await expect
      .poll(async () => (await state()).preview?.revisionId)
      .toBe((await state()).project!.currentRevisionId);
    await expect(page.frameLocator("iframe").locator("h1")).toBeVisible();
    await expect.poll(async () => (await state()).busy).toBe(false);
  };
  try {
    await launch();
    await page.screenshot({ path: info.outputPath("welcome.png") });
    // Only native file selection is supplied by the test; UI/IPC/build/preview are real.
    await app!.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: target,
      });
    }, projectDir);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByLabel("项目名称", { exact: true }).fill("山间工作室");
    await page.getByRole("button", { name: "选择位置并创建" }).click();
    await expect(
      page.getByRole("button", { name: "应用样例主题" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "应用样例主题" }).click();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "编辑" })).toHaveCount(0);
    await expect(page.getByLabel("首页标题")).toHaveCount(0);
    await expect(page.getByLabel("网站标题")).toHaveValue("让你的想法，在这里生长。");
    await page.getByLabel("网站简介").fill("尚未保存的简介");
    await expect(page.getByRole("button", { name: "返回项目首页" })).toBeDisabled();
    await expect(page.locator(".app-bar").getByRole("button", { name: /构建预览/ })).toBeDisabled();
    await page.getByRole("button", { name: "放弃修改" }).click();
    await app!.evaluate(({ shell }) => { shell.openPath = async (target) => {
      (globalThis as any).__openedSiteConfig = target; return "";
    }; });
    await page.getByRole("button", { name: /高级设置/ }).click();
    expect(await app!.evaluate(() => (globalThis as any).__openedSiteConfig)).toBe(path.join(projectDir, "site.yaml"));
    await expect(page.getByRole("tab", { name: /页面/ })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: /历史/ }).click();
    await expect(page.getByRole("tab", { name: /历史/ })).toHaveAttribute("aria-selected", "true");
    await page.locator(".history-entry").filter({ hasText: "创建本地项目" })
      .getByRole("button", { name: "查看改动" }).click();
    await expect(page.getByRole("dialog", { name: "查看版本改动" })).toContainText("当前版本 → 所选历史版本");
    await expect(page.getByRole("dialog", { name: "查看版本改动" })).toContainText("themes/canopy/theme.yaml");
    await page.getByRole("dialog", { name: "查看版本改动" }).getByRole("button", { name: "关闭" }).click();
    await page.getByRole("tab", { name: /页面/ }).click();
    await expect(page.locator(".app-bar").getByRole("button", { name: /构建预览/ })).toBeVisible();
    await page.getByLabel("讨论你的网站", { exact: true }).fill("保留这段未发送草稿");
    const columns = async () => page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return { left: box(".inspector"), chat: box(".workspace"), right: box(".sidebar"), compose: box(".chat-compose") };
    });
    const collapsed = await columns();
    expect(collapsed.left.x).toBeLessThan(collapsed.chat.x);
    expect(collapsed.chat.x).toBeLessThan(collapsed.right.x);
    expect(Math.abs(collapsed.compose.bottom - collapsed.chat.bottom)).toBeLessThan(2);
    await page.screenshot({ path: info.outputPath("chat-first-collapsed.png") });
    await build();
    await expect(page.getByLabel("讨论你的网站", { exact: true })).toHaveValue("保留这段未发送草稿");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "网站构建预览" })).not.toBeVisible();
    await expect(page.locator(".app-bar").getByRole("button", { name: /构建预览/ })).toBeFocused();
    await expect(page.locator("iframe")).toHaveCount(0);
    expect((await columns()).chat.width).toBe(collapsed.chat.width);
    await page.getByRole("button", { name: "构建预览" }).click();
    const original = (await state()).project!.currentRevisionId;
    await expect(page.frameLocator("iframe").locator("h1")).toHaveText(
      "让你的想法，在这里生长。",
    );
    await expect.poll(async () => (await state()).busy).toBe(false);
    await page.screenshot({ path: info.outputPath("desktop.png") });
    if (!process.env.BUKIT_BIN) {
      await fs.writeFile(path.join(root, "engine-mode"), "slow");
      await page.getByRole("button", { name: "关闭预览" }).click();
      await page.getByRole("button", { name: "构建预览", exact: false }).click();
      await expect(page.getByRole("dialog", { name: "网站构建预览" }).getByRole("status")).toContainText("正在构建当前版本…");
      await page.getByRole("button", { name: "取消构建" }).click();
      await expect.poll(async () => (await state()).project?.lastBuild?.status).toBe("cancelled");
      await expect(page.frameLocator("iframe").locator("h1")).toHaveText("让你的想法，在这里生长。");
      await fs.writeFile(path.join(root, "engine-mode"), "");
    }
    if (process.env.BUKIT_BIN) {
      await page.getByRole("button", { name: "关闭预览" }).click();
      await page.getByRole("button", { name: /关于 \/about/ }).click();
      await page.getByRole("button", { name: "构建预览" }).click();
      await expect(page.frameLocator("iframe").locator("h1")).toHaveText(
        "给好想法一个家",
      );
      await page.getByRole("button", { name: "关闭预览" }).click();
      await page.getByRole("button", { name: /首页 \// }).click();
      await page.getByRole("button", { name: "构建预览" }).click();
      await expect(page.frameLocator("iframe").locator("h1")).toHaveText(
        "让你的想法，在这里生长。",
      );
    }

    const previewFrame = page
      .frames()
      .find((frame) => frame.url().startsWith("http://127.0.0.1:"))!;
    expect(
      await previewFrame.evaluate(() => {
        const scope = globalThis as unknown as Record<string, unknown>;
        let parentBlocked = false;
        try {
          void parent.document;
        } catch {
          parentBlocked = true;
        }
        return {
          bridge: typeof scope.desktop,
          require: typeof scope.require,
          process: typeof scope.process,
          parentBlocked,
        };
      }),
    ).toEqual({
      bridge: "undefined",
      require: "undefined",
      process: "undefined",
      parentBlocked: true,
    });
    expect(await page.locator("iframe").getAttribute("sandbox")).toBe("");
    const invalid = await page.evaluate(async () => {
      try {
        await window.desktop.openRecent("../../outside");
        return "allowed";
      } catch {
        return "denied";
      }
    });
    expect(invalid).toBe("denied");

    await page.getByRole("button", { name: "关闭预览" }).click();
    // Seed a revision through the existing IPC to test stale-preview and restore behavior without a manual edit UI.
    await expect.poll(async () => (await state()).busy).toBe(false);
    await page.evaluate(() => window.desktop.editHeadline("为好想法，留一片空间。"));
    expect((await state()).preview?.revisionId).not.toBe((await state()).project?.currentRevisionId);
    await build();
    await expect(page.frameLocator("iframe").locator("h1")).toHaveText(
      "为好想法，留一片空间。",
    );
    await page.getByRole("button", { name: "切换窄屏宽度" }).click();
    await page.screenshot({ path: info.outputPath("narrow.png") });
    await page.getByRole("button", { name: "切换桌面宽度" }).click();
    await app!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1080, 720),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("minimum-window.png") });

    // Reopen a locally edited, invalid template to exercise real Bukit failure feedback.
    const lastURL = (await state()).preview!.url;
    const closed = app!.waitForEvent("close");
    await app!.evaluate(({ app }) => {
      setTimeout(() => {
        app.quit();
        app.quit();
      }, 100);
    });
    await closed;
    app = undefined;
    await expect(async () => {
      await expect(fetch(lastURL)).rejects.toThrow();
    }).toPass();
    const filename = path.join(projectDir, "bukitjalil.json");
    const project = JSON.parse(await fs.readFile(filename, "utf8")) as Project;
    const changed = structuredClone(
      project.revisions.find((r) => r.id === project.currentRevisionId)!,
    );
    changed.id = crypto.randomUUID();
    changed.headline = "这一次构建会失败";
    changed.summary = "测试无效主题";
    changed.theme!.files["themes/canopy/layouts/pages/index.html"] = "{{ if }}";
    changed.sourceFiles!["site.yaml"] = withSiteInfo(changed.sourceFiles!["site.yaml"], changed.headline, "");
    changed.sourceFiles!["themes/canopy/layouts/pages/index.html"] = "{{ if }}";
    project.revisions.push(changed);
    project.currentRevisionId = changed.id;
    await fs.writeFile(filename, JSON.stringify(project));
    await fs.writeFile(path.join(projectDir, "site.yaml"), changed.sourceFiles!["site.yaml"]);
    if (!process.env.BUKIT_BIN)
      await fs.writeFile(path.join(root, "engine-mode"), "fail");
    await launch();
    await page.getByRole("button", { name: "构建预览" }).click();
    await expect
      .poll(async () => (await state()).project?.lastBuild?.status)
      .toBe("failed");
    await expect(page.frameLocator("iframe").locator("h1")).toHaveText(
      "为好想法，留一片空间。",
    );
    await page.getByRole("button", { name: "构建日志", exact: false }).click();
    await expect(page.getByRole("region", { name: "构建日志" })).toContainText(
      /Error|synthetic build failure/,
    );
    await page.screenshot({ path: info.outputPath("failed-build.png") });
    if (!process.env.BUKIT_BIN)
      await fs.writeFile(path.join(root, "engine-mode"), "");
    await page.getByRole("button", { name: "关闭预览" }).click();
    await page.getByRole("tab", { name: /历史/ }).click();
    await page
      .locator(".history-entry")
      .filter({
        has: page.getByText("应用 Canopy 1.0.0 的独立副本", { exact: true }),
      })
      .getByRole("button", { name: "恢复此版本" })
      .click();
    await expect
      .poll(async () => (await state()).project!.currentRevisionId)
      .toBe(original);
    await build();
    await expect(page.frameLocator("iframe").locator("h1")).toHaveText(
      "让你的想法，在这里生长。",
    );
    await app!.close();
    app = undefined;
    await launch();
    expect((await state()).project!.currentRevisionId).toBe(original);
    await page.getByRole("button", { name: "构建预览" }).click();
    await expect(page.frameLocator("iframe").locator("h1")).toHaveText(
      "让你的想法，在这里生长。",
    );
    await app!.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [target],
      });
    }, projectDir);
    await page.getByRole("button", { name: "关闭预览" }).click();
    await page.getByRole("button", { name: "返回项目首页" }).click();
    await page.getByRole("button", { name: "打开项目", exact: true }).click();
    await page.getByRole("button", { name: "构建预览" }).click();
    await expect(page.frameLocator("iframe").locator("h1")).toHaveText(
      "让你的想法，在这里生长。",
    );
  } finally {
    await app?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("read-only Codex chat: stream, background project, cancel, reconcile and reopen (synthetic server)", async ({}, info) => {
  const { ProjectStore, newRevision } = await import("../src/main/project");
  const { sampleTheme } = await import("../src/main/theme");
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bukitjalil-chat-gui-")));
  const dataDir = path.join(root, "app");
  await fs.mkdir(dataDir);
  const a = await ProjectStore.create(path.join(root, "site-a"), "站点 A");
  const b = await ProjectStore.create(path.join(root, "site-b"), "站点 B");
  for (const project of [a, b])
    await project.revise(newRevision(project.current().headline, sampleTheme(), "应用主题"));
  const aId = crypto.randomUUID();
  const binary = path.join(root, "codex"), engine = path.join(root, "bukit");
  await fs.copyFile(new URL("./fixtures/fake-codex.cjs", import.meta.url), binary);
  await fs.copyFile(new URL("./fixtures/fake-bukit.cjs", import.meta.url), engine);
  await fs.chmod(binary, 0o700); await fs.chmod(engine, 0o700);
  await fs.writeFile(path.join(root, "mode.json"), JSON.stringify({ slowInterrupt: true }));
  await fs.writeFile(path.join(dataDir, "session.json"), JSON.stringify({
    recent: [{ id: aId, name: "站点 A", path: a.root }, { id: crypto.randomUUID(), name: "站点 B", path: b.root }],
    lastProjectId: aId, binary: engine,
  }));
  let app: ElectronApplication | undefined;
  let page!: Page;
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    BUKITJALIL_DATA_DIR: dataDir, BUKITJALIL_CODEX_BIN: binary, BUKIT_BIN: engine,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  async function launch() {
    app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
    page = await app.firstWindow();
    await page.waitForURL("bukitjalil://app/index.html");
    await expect(page.getByRole("main", { name: "项目首页" })).toBeVisible();
    await page.getByRole("button", { name: "打开项目 站点 A", exact: true }).click();
  }
  const state = () => page.evaluate(() => window.desktop.chatState());
  const send = async (text: string) => {
    await page.getByLabel("讨论你的网站", { exact: true }).fill(text);
    await page.getByLabel("讨论你的网站", { exact: true }).press("Enter");
  };
  try {
    await launch();
    await page.getByRole("button", { name: "构建预览", exact: false }).click();
    await expect(page.frameLocator("iframe").locator("h1")).toBeVisible();
    await page.getByRole("button", { name: "关闭预览" }).click();
    const beforeA = JSON.parse(await fs.readFile(path.join(a.root, "bukitjalil.json"), "utf8")).revisions;
    const beforeB = JSON.parse(await fs.readFile(path.join(b.root, "bukitjalil.json"), "utf8")).revisions;
    await page.getByLabel("讨论你的网站", { exact: true }).fill("离线草稿");
    await page.getByLabel("讨论你的网站", { exact: true }).press("Enter");
    await expect(page.getByLabel("讨论你的网站", { exact: true })).toHaveValue("离线草稿");
    await expect(page.locator(".chat-message.user")).toHaveCount(0);
    const connectAction = page.getByRole("button", { name: "连接 Codex", exact: true });
    expect(await connectAction.evaluate((button) => ({ height: button.getBoundingClientRect().height,
      radius: getComputedStyle(button).borderRadius }))).toEqual({ height: 34, radius: "7px" });
    await connectAction.click();
    await expect(page.getByText("Codex · ChatGPT 已登录", { exact: true })).toBeVisible();
    await page.getByLabel("讨论你的网站", { exact: true }).fill("");
    await page.getByLabel("讨论你的网站", { exact: true }).press("Enter");
    await expect(page.locator(".chat-message.user")).toHaveCount(0);
    await send("慢消息 A");
    await expect(page.getByRole("log", { name: "当前项目对话" })).toContainText("站点建议：");
    await expect(page.locator(".chat-turn-status")).toHaveText("正在回复");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.locator(".chat-turn-status").evaluate((item) => getComputedStyle(item).transitionDuration)).toBe("0s");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveAttribute("title", "停止");
    const stopGeometry = await page.locator(".chat-input-row").evaluate((row) => {
      const input = row.querySelector("textarea")!.getBoundingClientRect();
      const stop = row.querySelector("button")!.getBoundingClientRect();
      const status = row.parentElement!.querySelector(".chat-turn-status")!.getBoundingClientRect();
      return { inputRight: input.right, inputTop: input.top, stopLeft: stop.left, stopWidth: stop.width,
        stopHeight: stop.height, statusRight: status.right, statusBottom: status.bottom };
    });
    expect(stopGeometry.stopLeft).toBeGreaterThan(stopGeometry.inputRight);
    expect(stopGeometry.stopWidth).toBeLessThanOrEqual(38);
    expect(stopGeometry.stopHeight).toBeLessThanOrEqual(38);
    expect(stopGeometry.statusRight).toBeGreaterThan(stopGeometry.inputRight - 20);
    expect(stopGeometry.statusBottom).toBeLessThan(stopGeometry.inputTop);
    await expect.poll(async () => (await state()).conversations[a.root]?.status).toBe("running");
    await page.getByLabel("讨论你的网站", { exact: true }).fill("忙时不发送");
    await page.getByLabel("讨论你的网站", { exact: true }).press("Enter");
    await expect(page.getByLabel("讨论你的网站", { exact: true })).toHaveValue("忙时不发送");
    await page.getByLabel("讨论你的网站", { exact: true }).fill("A 的未发送草稿");
    await page.getByRole("button", { name: "返回项目首页" }).click();
    await expect(page.getByLabel("站点 A 对话进行中", { exact: true })).toBeVisible();
    const activeCard = page.locator(".project-card").filter({ has: page.getByRole("button", { name: "打开项目 站点 A", exact: true }) });
    await activeCard.locator("summary").click();
    await expect(activeCard.getByRole("button", { name: "移除入口" })).toBeDisabled();
    await activeCard.locator("summary").click();
    expect(await page.evaluate(async (id) => {
      try { await window.desktop.removeProject(id); return "allowed"; } catch { return "denied"; }
    }, aId)).toBe("denied");
    await page.screenshot({ path: info.outputPath("chat-background-project.png") });
    await page.getByRole("button", { name: "打开项目 站点 B", exact: true }).click();
    await expect(page.getByLabel("讨论你的网站", { exact: true })).toHaveValue("");
    const input = page.getByLabel("讨论你的网站", { exact: true });
    await input.fill("B 的首页");
    await input.dispatchEvent("compositionstart");
    await input.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, cancelable: true, isComposing: true,
    })));
    await expect(input).toHaveValue("B 的首页");
    await expect(page.locator(".chat-message.user")).toHaveCount(0);
    await input.dispatchEvent("compositionend");
    await input.press("Shift+Enter");
    await expect(input).toHaveValue("B 的首页\n");
    await input.press("Enter");
    await expect.poll(async () => (await state()).conversations[b.root]?.status).toBe("completed");
    await expect(page.getByRole("button", { name: "发送", exact: true })).toHaveCount(0);
    await expect(page.locator(".chat-turn-status")).toHaveCount(0);
    await expect(page.getByText("讨论你的网站", { exact: true })).toHaveCount(0);
    const bubbles = await page.locator(".chat-messages").evaluate((log) => {
      const user = log.querySelector<HTMLElement>(".chat-message.user")!;
      const assistant = log.querySelector<HTMLElement>(".chat-message.assistant")!;
      const container = log.getBoundingClientRect();
      const userBox = user.getBoundingClientRect(), assistantBox = assistant.getBoundingClientRect();
      const longCode = "```ts\nconst value = '" + "x".repeat(600) + "';\n```";
      const probe = user.cloneNode(true) as HTMLElement;
      probe.querySelector("p")!.textContent = longCode;
      log.append(probe);
      const overflow = probe.scrollWidth > probe.clientWidth || log.scrollWidth > log.clientWidth;
      probe.remove();
      return { userRightGap: container.right - userBox.right, assistantLeftGap: assistantBox.left - container.left,
        userWidth: userBox.width, assistantWidth: assistantBox.width, containerWidth: container.width, overflow };
    });
    expect(bubbles.userRightGap).toBeLessThan(24);
    expect(bubbles.assistantLeftGap).toBeLessThan(24);
    expect(bubbles.userWidth).toBeLessThan(bubbles.containerWidth * 0.83);
    expect(bubbles.assistantWidth).toBeLessThan(bubbles.containerWidth * 0.83);
    expect(bubbles.overflow).toBe(false);
    await page.screenshot({ path: info.outputPath("chat-bubbles.png") });
    await expect(page.getByRole("log", { name: "当前项目对话" })).not.toContainText("慢消息 A");
    await page.getByRole("button", { name: "返回项目首页" }).click();
    await expect(page.getByLabel("站点 A 对话进行中", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "打开项目 站点 A", exact: true }).click();
    await expect(page.getByLabel("讨论你的网站", { exact: true })).toHaveValue("A 的未发送草稿");
    await page.getByRole("button", { name: "停止", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "正在停止", exact: true })).toBeDisabled();
    await expect(page.locator(".chat-turn-status")).toHaveText("正在停止");
    await page.screenshot({ path: info.outputPath("chat-stopping.png") });
    await expect.poll(async () => (await state()).conversations[a.root]?.status).toBe("interrupted");
    await expect(page.locator(".chat-turn-status")).toHaveCount(0);
    await expect(page.locator(".chat-stop")).toHaveCount(0);
    await send("失败");
    await expect.poll(async () => (await state()).conversations[a.root]?.status).toBe("failed");
    await expect(page.getByRole("alert")).toContainText("Codex 本轮失败");
    await expect(page.locator(".chat-turn-status")).toHaveText("回复失败");
    await page.screenshot({ path: info.outputPath("chat-error.png") });
    await send("断线");
    await expect(page.getByRole("button", { name: "核对并恢复会话" })).toBeVisible();
    await page.getByRole("button", { name: "核对并恢复会话" }).click();
    await expect.poll(async () => (await state()).conversations[a.root]?.status).toBe("completed");
    await expect(page.getByRole("log", { name: "当前项目对话" })).toContainText("已保存的站点建议");
    // Preview still has neither the old nor new privileged API.
    await page.getByRole("button", { name: "构建预览" }).click();
    await expect(page.frameLocator("iframe").locator("h1")).toBeVisible();
    const preview = page.frames().find((frame) => frame.url().startsWith("http://127.0.0.1:"))!;
    expect(await preview.evaluate(() => typeof (globalThis as any).desktop)).toBe("undefined");
    await expect(page.locator("iframe")).toHaveAttribute("sandbox", "");
    expect(JSON.parse(await fs.readFile(path.join(a.root, "bukitjalil.json"), "utf8")).revisions).toEqual(beforeA);
    expect(JSON.parse(await fs.readFile(path.join(b.root, "bukitjalil.json"), "utf8")).revisions).toEqual(beforeB);
    await page.screenshot({ path: info.outputPath("chat-reconciled.png") });
    await app!.close(); app = undefined;
    await launch();
    await expect(page.getByRole("log", { name: "当前项目对话" })).toContainText("已保存的站点建议");
    const requests = (await fs.readFile(path.join(root, "requests.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(requests.filter((r) => r.method === "thread/start")).toHaveLength(2);
    expect(requests.filter((r) => r.method === "turn/start")).toHaveLength(4);
    expect(requests.filter((r) => r.method === "turn/interrupt")).toHaveLength(1);
  } finally {
    await app?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
