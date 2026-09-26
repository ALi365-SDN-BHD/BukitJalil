// Opt-in, one real model turn in a disposable site. Stops for human/agent diff review before each decision.
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../src/main/project";
import { sourceFiles } from "../src/main/source";
import { sourceHash, readCopy } from "../src/main/generation";
import { siteConfig } from "../src/main/theme";

const decision = process.env.BUKITJALIL_REAL_ACCEPT === "one-turn-apply" ? "apply"
  : process.env.BUKITJALIL_REAL_ACCEPT === "one-turn-reject" ? "reject" : null;
if (!decision) throw new Error("Explicit one-turn-apply or one-turn-reject authorization is required.");
if (!process.env.BUKIT_BIN || !process.env.BUKITJALIL_CODEX_BIN) throw new Error("Provide the existing real Bukit and official Codex executable paths.");
const cwd = fileURLToPath(new URL("..", import.meta.url));
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bukitjalil-live-stage2-")));
const appDir = path.join(root, "app"), site = path.join(root, "site");
const out = path.join(cwd, "test-results", "live-stage2-" + Date.now()); await fs.mkdir(out, { recursive: true });
const reportPath = path.join(out, "acceptance.json");
const stdin = createInterface({ input: process.stdin, output: process.stdout });
const report: any = { status: "running", root, branch: execFileSync("git", ["branch", "--show-current"], { cwd, encoding: "utf8" }).trim(),
  baseHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(), modelTurns: 0, decision, realRejectRepeated: decision === "reject", rounds: [], audits: [], cleanup: {} };
const persist = async () => fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const snapshot = async () => {
  const store = await ProjectStore.open(site);
  return { manifest: hash(await fs.readFile(path.join(site, "bukitjalil.json"), "utf8")),
    sources: sourceHash(sourceFiles(store.current())), revision: store.current().id, headline: store.current().headline, format: store.data.format };
};
let app: ElectronApplication | undefined, page!: Page, auditFile = "";
const state = () => page.evaluate(() => window.desktop.state());
const title = "真实验收：山间新篇";
const prompt = `请只通过 bukitjalil.edit_website_copy 工具一次性完成两处实际修改：
1. site.yaml 只把 site.title 改为 JSON 双引号字符串“${title}”，其他所有行和结尾换行保持原样。
2. 新增 content/verification.md，完整内容如下（代码围栏不是文件内容）：
---
title: 真实验收页面
slug: verification
type: page
collection: page
publishAt: 2026-01-01T00:00:00Z
---
LIVE_CODEX_STAGE2_OK

这一页由真实 Codex 修改生成副本，再经审核应用。

不要修改其他文件，不要调用其他工具，不要尝试构建、执行命令、联网、读取宿主或部署。必须实际调用唯一的副本编辑工具，完成后用中文简述两项修改。`;

async function launch() {
  auditFile = path.join(out, `protocol-${report.audits.length + 1}.json`);
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    BUKITJALIL_DATA_DIR: appDir };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ["."], cwd, env });
  page = await app.firstWindow(); await page.waitForURL("bukitjalil://app/index.html");
  await app.evaluate("globalThis.__name = (value) => value");
  await app.evaluate((_electron, filename) => {
    const cp = process.getBuiltinModule("node:child_process"), fs = process.getBuiltinModule("node:fs"), crypto = process.getBuiltinModule("node:crypto");
    const audit: any = { appPid: process.pid, processes: [], turns: [], threads: [], tools: [], configs: [], threadRequests: [], events: [], deltaCharacters: 0 };
    const save = () => fs.writeFileSync(filename, JSON.stringify(audit, null, 2) + "\n");
    const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
    const spawn = cp.spawn;
    (cp as any).spawn = function (binary: string, args: string[], options: any) {
      const child = spawn(binary, args, options);
      const processRecord: any = { pid: child.pid, executable: binary, command: args[0], cwd: options?.cwd, closed: false };
      audit.processes.push(processRecord); save();
      child.once("close", (code: number | null) => { processRecord.closed = true; processRecord.exitCode = code; save(); });
      if (args[0] !== "app-server") return child;
      const requests = new Map(), calls = new Map(); let buffer = "";
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = function (chunk: any, ...rest: any[]) {
        try {
          const m = JSON.parse(String(chunk));
          if (m.method) requests.set(m.id, m.method);
          if (m.method === "thread/start") audit.threadRequests.push({ dynamicTools: m.params.dynamicTools, sandbox: m.params.sandbox, approvalPolicy: m.params.approvalPolicy });
          if (m.method === "turn/start") audit.turns.push({ pid: child.pid, time: new Date().toISOString(), threadId: m.params.threadId,
            approvalPolicy: m.params.approvalPolicy, sandboxPolicy: m.params.sandboxPolicy, inputSha256: sha(JSON.stringify(m.params.input)) });
          if (calls.has(m.id)) { calls.get(m.id).clientSuccess = m.result?.success === true; calls.get(m.id).clientErrorCode = m.error?.code ?? null; calls.get(m.id).response = m.result ?? null; }
          save();
        } catch { /* Ignore non-JSON test instrumentation input; never record credentials. */ }
        return write(chunk, ...rest);
      };
      child.stdout.on("data", (chunk: any) => {
        buffer += String(chunk); let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const m = JSON.parse(line), p = m.params ?? {};
            if (requests.get(m.id) === "config/read" && m.result) {
              const c = m.result.config; audit.configs.push({ pid: child.pid, sandbox: c.sandbox_mode, approvalPolicy: c.approval_policy,
                codeMode: c.features?.code_mode, codeModeHost: c.features?.code_mode_host, shell: c.features?.shell_tool, unifiedExec: c.features?.unified_exec });
            }
            if (requests.get(m.id) === "thread/start" && m.result) audit.threads.push({ pid: child.pid, threadId: m.result.thread?.id,
              model: m.result.model, sandbox: m.result.sandbox, approvalPolicy: m.result.approvalPolicy, approvalsReviewer: m.result.approvalsReviewer });
            if (m.method === "item/tool/call") {
              const call: any = { pid: child.pid, threadId: p.threadId, turnId: p.turnId, callId: p.callId,
                tool: p.tool, namespace: p.namespace, argumentType: typeof p.arguments, arguments: p.arguments,
                files: Array.isArray(p.arguments?.files) ? p.arguments.files.map((f: any) => ({ path: f.path, bytes: typeof f.content === "string" ? Buffer.byteLength(f.content) : null,
                  sha256: typeof f.content === "string" ? sha(f.content) : null })) : null };
              calls.set(m.id, call); audit.tools.push(call);
            }
            if (m.method === "item/agentMessage/delta") audit.deltaCharacters += String(p.delta ?? "").length;
            if (["turn/started", "turn/completed", "error", "item/started"].includes(m.method)) audit.events.push({ method: m.method, threadId: p.threadId,
              turnId: p.turnId ?? p.turn?.id, status: p.turn?.status, itemType: p.item?.type,
              error: p.error?.message ?? p.turn?.error?.message ?? null });
            save();
          } catch { /* Capture only whitelisted protocol metadata, never raw account/config responses. */ }
        }
      });
      return child;
    };
    save();
  }, auditFile);
}
async function audit() { return JSON.parse(await fs.readFile(auditFile, "utf8")); }
async function close() {
  if (!app) return;
  const before = await audit().catch(() => ({ processes: [] })), pid = app.process().pid!;
  const previewUrl = await state().then((s) => s.preview?.url).catch(() => undefined);
  await app.close(); app = undefined;
  const data = await audit().catch(() => ({ turns: [], processes: [] })); report.audits.push(data);
  if (previewUrl) {
    await expect.poll(async () => {
      try { await fetch(previewUrl, { signal: AbortSignal.timeout(1000) }); return false; } catch { return true; }
    }).toBe(true);
    report.cleanup.closedPreviewUnreachable = true;
  }
  const pids = [pid, ...before.processes.map((p: any) => p.pid)];
  for (let i = 0; i < 100; i++) {
    const alive = pids.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
    if (!alive.length) { report.cleanup.ownedProcessesExited = true; await persist(); return; }
    if (i === 99) throw new Error("Owned processes still alive: " + alive.join(","));
    await new Promise((r) => setTimeout(r, 50));
  }
}
async function build() {
  await page.getByRole("button", { name: "构建预览", exact: false }).click();
  await expect.poll(async () => { const s = await state(); return !s.busy && s.project?.lastBuild?.status; }, { timeout: 125_000 }).toBe("success");
  await expect.poll(async () => (await state()).preview?.revisionId).toBe((await state()).project!.currentRevisionId);
}
async function generate(round: number, baseline: any) {
  if ((await audit()).turns.length !== round - 1) throw new Error("Unexpected model count; refusing automatic retry.");
  await page.getByLabel("讨论你的网站", { exact: true }).fill(prompt);
  await page.getByRole("button", { name: "生成修改 · 先审核副本" }).click();
  await expect.poll(async () => ["review", "failed", "cancelled"].includes((await state()).generation?.status ?? ""), { timeout: 330_000, intervals: [500, 1000, 2000] }).toBe(true);
  const s = await state(), g = s.generation!;
  report.modelTurns = (await audit()).turns.length;
  report.rounds.push({ round, generationId: g.id, status: g.status, error: g.error, modelReply: g.text, changes: g.changes, hash: g.hash }); await persist();
  if (g.status !== "review") throw new Error("Real generation did not reach review: " + g.error);
  const officialAfterGeneration = await snapshot();
  report.rounds.at(-1).officialAfterGeneration = officialAfterGeneration;
  expect(officialAfterGeneration).toEqual(baseline);
  report.rounds.at(-1).officialUnchangedBeforeDecision = true;
  await persist();
  expect(g.changes.map((f) => f.path).sort()).toEqual(["content/verification.md", "site.yaml"]);
  expect(g.changes.find((f) => f.path === "site.yaml")!.after).toBe(siteConfig(title));
  const added = g.changes.find((f) => f.path === "content/verification.md")!;
  expect(added.kind).toBe("added"); expect(added.after).toContain("LIVE_CODEX_STAGE2_OK");
  expect(added.after).toMatch(/^slug: verification$/m);
  expect(sourceHash(await readCopy(path.join(appDir, "generation-copies", g.id)))).toBe(g.hash);
  const native = await audit();
  expect(native.tools.filter((tool: any) => tool.tool === "edit_website_copy" && tool.namespace === "bukitjalil" && tool.clientSuccess).length).toBeGreaterThanOrEqual(round);
  await page.getByRole("button", { name: "审核 2 个文件差异" }).click();
  const dialog = page.getByRole("dialog", { name: "审核生成修改" }); await expect(dialog).toBeVisible();
  await dialog.getByText("新增 · content/verification.md", { exact: true }).click();
  await dialog.getByText("修改 · site.yaml", { exact: true }).click();
  await expect(dialog.getByText(/LIVE_CODEX_STAGE2_OK/)).toBeVisible();
  const screenshot = path.join(out, `round-${round}-review.png`); await page.screenshot({ path: screenshot });
  report.rounds.at(-1).screenshot = screenshot; report.rounds.at(-1).officialUnchangedBeforeDecision = true;
  await persist();
  console.log(JSON.stringify({ milestone: "review-required", round, reportPath, screenshot, changes: g.changes, modelReply: g.text, native: await audit() }));
}
try {
  console.log(JSON.stringify({ milestone: "starting", root, reportPath, maxModelTurns: 1 }));
  await launch();
  await app!.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, site);
  await page.getByRole("button", { name: "创建第一个项目" }).click();
  await page.getByLabel("项目名称", { exact: true }).fill("真实 Codex 临时验收");
  await page.getByRole("button", { name: "选择位置并创建" }).click();
  await page.getByRole("button", { name: "应用样例主题" }).click();
  await expect(page.getByRole("button", { name: "✓ 已应用独立副本" })).toBeVisible();
  await build(); const baseline = await snapshot(); report.baseline = baseline;
  const baselinePreview = (await state()).preview; report.baselinePreview = baselinePreview;
  await page.getByRole("tab", { name: "对话", exact: true }).click();
  await page.getByRole("button", { name: "连接 Codex", exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.desktop.chatState())).connection).toBe("ready");
  const chat = await page.evaluate(() => window.desktop.chatState());
  if (!chat.account) throw new Error("No existing authenticated account; login changes are not authorized.");
  report.codexVersion = chat.version; report.accountType = chat.account.type; await persist();
  await generate(1, baseline);
  if ((await stdin.question(`REVIEW 1: inspect diff and screenshot, then type ${decision}: `)).trim() !== decision) throw new Error("Review was not explicitly approved.");
  if (decision === "apply") {
    await page.getByRole("button", { name: "确认应用并构建", exact: true }).click();
    await expect.poll(async () => (await state()).generation?.status, { timeout: 125_000 }).toBe("applied");
    await expect.poll(async () => { const s = await state(); return !s.busy && s.project?.lastBuild?.status; }, { timeout: 125_000 }).toBe("success");
    await expect(page.frameLocator("iframe").locator("h1")).toHaveText(title);
    const applied = await snapshot(); expect(applied.format).toBe(2); expect(applied.revision).not.toBe(baseline.revision);
    report.applied = applied; report.build = (await state()).project!.lastBuild;
    await page.screenshot({ path: path.join(out, "applied-home.png") });
    await page.getByRole("button", { name: /真实验收页面 \/verification/ }).click();
    await expect(page.frameLocator("iframe").locator("article")).toContainText("LIVE_CODEX_STAGE2_OK");
    await page.screenshot({ path: path.join(out, "applied-new-page.png") });
    report.newPagePreview = true; await persist(); await close();
    await launch();
    await expect.poll(async () => (await state()).preview?.revisionId).toBe(applied.revision);
    await expect(page.frameLocator("iframe").locator("h1")).toHaveText(title);
    expect((await snapshot()).sources).toBe(applied.sources); report.reopenedAppliedVersion = true;
    await page.getByRole("tab", { name: /历史/ }).click();
    await page.locator(".history-entry").filter({ hasText: "应用 Canopy 1.0.0 的独立副本" }).getByRole("button", { name: /恢复此版本/ }).click();
    await expect.poll(async () => (await state()).project?.currentRevisionId).toBe(baseline.revision);
    await build(); await expect(page.frameLocator("iframe").locator("h1")).toHaveText(baseline.headline);
    expect((await snapshot()).sources).toBe(baseline.sources);
    expect((await state()).project!.revisions.some((r) => r.id === applied.revision)).toBe(true);
    expect((await fetch((await state()).preview!.url + "verification/")).status).toBe(404);
    report.historyRestored = true; await page.screenshot({ path: path.join(out, "history-restored.png") });
  } else {
    const copyPath = path.join(appDir, "generation-copies", (await state()).generation!.id);
    await page.getByRole("button", { name: "拒绝修改", exact: true }).click();
    await expect.poll(async () => { const s = await state(); return !s.busy && s.generation?.status; }).toBe("rejected");
    const after = await snapshot(); expect(after).toEqual(baseline);
    const preview = (await state()).preview; expect(preview).toEqual(baselinePreview);
    await expect(page.frameLocator("iframe").locator("h1")).toHaveText(baseline.headline);
    expect((await fetch(preview!.url)).status).toBe(200);
    expect(await fs.lstat(copyPath).then(() => true).catch(() => false)).toBe(false);
    report.rejected = { officialAfterRejection: after, previewAfterRejection: preview, originalPreviewStillUsable: true, copyRemoved: true };
    await page.screenshot({ path: path.join(out, "rejected-home.png") }); await persist();
  }
  await close(); report.modelTurns = report.audits.reduce((n: number, a: any) => n + a.turns.length, 0);
  expect(report.modelTurns).toBe(1); report.status = "SUCCESS";
} catch (error) {
  report.status = "PARTIAL"; report.error = error instanceof Error ? error.message : String(error);
  if (app) { try { const a = await audit(); report.modelTurns = report.audits.reduce((n: number, a: any) => n + a.turns.length, 0) + a.turns.length; } catch {} }
  console.error(JSON.stringify({ milestone: "failed", error: report.error, modelTurns: report.modelTurns, reportPath }));
  process.exitCode = 1;
} finally {
  await close().catch((error) => { report.cleanup.error = String(error); report.status = "PARTIAL"; process.exitCode = 1; });
  stdin.close();
  await fs.rm(root, { recursive: true, force: true }); report.cleanup.temporarySiteAndAppRemoved = true;
  await persist(); console.log(JSON.stringify({ milestone: "finished", status: report.status, modelTurns: report.modelTurns, cleanup: report.cleanup, reportPath }));
}
