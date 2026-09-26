import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../src/main/workspace";
import { CodexChat } from "../src/main/codex";
import { sourceHash, readCopy } from "../src/main/generation";
import { sourceFiles } from "../src/main/source";
import { ProjectStore } from "../src/main/project";

async function setup(t: test.TestContext, real = false) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bukitjalil-generation-")));
  const codexBin = path.join(root, "codex"), fakeBukit = path.join(root, "bukit");
  for (const [fixture, target] of [["fake-codex.cjs", codexBin], ["fake-bukit.cjs", fakeBukit]]) {
    await fs.copyFile(new URL("./fixtures/" + fixture, import.meta.url), target); await fs.chmod(target, 0o700);
  }
  const data = path.join(root, "app"), site = path.join(root, "site");
  const workspace = new Workspace(data);
  await workspace.initialize(real ? process.env.BUKIT_BIN : fakeBukit);
  await workspace.create(site, "副本生成测试"); await workspace.applyTheme();
  const codex = new CodexChat(data, () => workspace.chatContext(), () => {}, async () => {}, codexBin);
  await codex.initialize(); await codex.connect();
  t.after(async () => { await workspace.dispose(); await codex.dispose(); await fs.rm(root, { recursive: true, force: true }); });
  const manifest = () => fs.readFile(path.join(site, "bukitjalil.json"), "utf8");
  const generate = (text = "请生成修改") => workspace.generate({ projectPath: site, text }, codex);
  const approval = () => { const g = workspace.state().generation!; return { projectPath: site, id: g.id, hash: g.hash! }; };
  const copy = () => path.join(data, "generation-copies", workspace.state().generation!.id);
  const requests = async () => (await fs.readFile(path.join(root, "requests.jsonl"), "utf8")).trim().split("\n").map((s) => JSON.parse(s));
  return { root, site, data, workspace, codex, manifest, generate, approval, copy, requests };
}
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 400; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 10)); }
  assert.fail("timed out waiting for copy write");
}

test("synthetic Codex edits a real copy; diff includes add/modify/delete; reject then apply, build, edit and restore", async (t) => {
  const f = await setup(t), original = await f.manifest();
  await f.generate();
  assert.equal(f.workspace.state().generation!.status, "review");
  assert.equal(await f.manifest(), original);
  const changes = f.workspace.state().generation!.changes;
  assert.deepEqual(changes.map((c) => [c.path, c.kind]), [
    ["content/about.md", "deleted"], ["content/story.md", "added"], ["site.yaml", "modified"], ["themes/canopy/layouts/pages/index.html", "modified"],
  ]);
  assert.match(changes.find((c) => c.path === "site.yaml")!.after!, /来自 AI/);
  assert.equal(sourceHash(await readCopy(f.copy())), f.approval().hash);
  await assert.rejects(f.workspace.editHeadline("manual"), /审核/);
  await assert.rejects(f.workspace.open(f.site), /审核/);
  await assert.rejects(f.workspace.approveGeneration({ ...f.approval(), projectPath: "wrong-project" }), /当前项目/);
  const discarded = f.copy();
  await f.workspace.rejectGeneration(f.approval());
  assert.equal(await f.manifest(), original);
  await assert.rejects(fs.stat(discarded), { code: "ENOENT" });
  await f.generate();
  const approved = f.approval(), oldRevision = f.workspace.state().project!.currentRevisionId;
  await f.workspace.approveGeneration(approved);
  assert.equal(f.workspace.state().generation!.status, "applied");
  assert.equal(f.workspace.state().project!.lastBuild!.status, "success");
  assert.match(await (await fetch(f.workspace.state().preview!.url)).text(), /来自 AI/);
  assert.equal(await fs.readFile(path.join(f.site, ".bukitjalil/recovery", approved.id + ".json"), "utf8"), original);
  let store = await ProjectStore.open(f.site);
  assert.equal(store.data.format, 2, "old applications must reject the extended source format instead of discarding edits");
  assert.match(store.current().theme!.files["themes/canopy/layouts/pages/index.html"], /来自生成副本/);
  assert.equal(sourceFiles(store.current())["content/about.md"], undefined);
  assert.ok(sourceFiles(store.current())["content/story.md"]);
  await f.workspace.editHeadline("手动修改保留生成内容");
  store = await ProjectStore.open(f.site);
  assert.ok(sourceFiles(store.current())["content/story.md"]);
  await f.workspace.restore(oldRevision);
  assert.equal(sourceFiles((await ProjectStore.open(f.site)).current())["content/story.md"], undefined);
  const requests = await f.requests(), starts = requests.filter((r) => r.method === "thread/start");
  assert.equal(starts.length, 2);
  assert.ok(starts.every((r) => r.params.ephemeral && r.params.sandbox === "read-only" && r.params.dynamicTools.length === 1 &&
    r.params.dynamicTools[0].type === "namespace" && r.params.dynamicTools[0].name === "bukitjalil" &&
    r.params.dynamicTools[0].tools.length === 1 && r.params.dynamicTools[0].tools[0].name === "edit_website_copy"));
  assert.notEqual(starts[0].params.cwd, starts[1].params.cwd);
  assert.equal(requests.filter((r) => r.method === "turn/start").length, 2);
  assert.ok(requests.filter((r) => r.method === "turn/start").every((r) => r.params.sandboxPolicy.type === "readOnly" && !r.params.sandboxPolicy.networkAccess));
});

test("official baseline and reviewed copy changes invalidate approval; no stale token can be replayed", async (t) => {
  const f = await setup(t);
  await f.generate();
  const approval = f.approval(), external = (await f.manifest()) + "\n";
  await fs.writeFile(path.join(f.site, "bukitjalil.json"), external);
  await assert.rejects(f.workspace.approveGeneration(approval), /其他程序修改/);
  assert.equal(await f.manifest(), external);
  await f.workspace.open(f.site);
  await f.generate();
  const baseline = await f.manifest(), next = f.approval();
  await fs.appendFile(path.join(f.copy(), "content/story.md"), "post-review change");
  await assert.rejects(f.workspace.approveGeneration(next), /审批失效/);
  assert.equal(await f.manifest(), baseline);
  await assert.rejects(f.workspace.approveGeneration(next), /已失效/);
});

test("cancel, failure, disconnect, denied elevation and cross-task requests never apply or resend", async (t) => {
  const f = await setup(t), original = await f.manifest();
  const pending = f.generate("慢生成");
  await until(async () => !!await fs.stat(path.join(f.root, "copy-written")).catch(() => null));
  await assert.rejects(f.workspace.editHeadline("concurrent"), /当前操作/);
  await f.workspace.cancel(); await pending;
  assert.equal(f.workspace.state().generation!.status, "cancelled");
  for (const text of ["生成失败", "生成断线", "请求提权", "跨任务", "跨命名空间", "越界"]) {
    await assert.rejects(f.generate(text));
    assert.equal(f.workspace.state().generation!.status, "failed");
    assert.equal(await f.manifest(), original);
  }
  assert.deepEqual(await fs.readdir(path.join(f.data, "generation-copies")), []);
  assert.equal((await f.requests()).filter((r) => r.method === "turn/start").length, 7);
  await f.codex.connect();
  assert.equal((await f.requests()).filter((r) => r.method === "turn/start").length, 7);
});

test("symlink, hardlink, traversal, unknown types, invalid UTF-8 and oversized actual copy files are rejected", async (t) => {
  const f = await setup(t), baseline = await f.manifest();
  const outside = path.join(f.root, "outside"); await fs.writeFile(outside, "untouched");
  for (const mutate of [
    async (copy: string) => fs.symlink(outside, path.join(copy, "content/linked.md")),
    async (copy: string) => fs.link(outside, path.join(copy, "content/linked.md")),
    async (copy: string) => fs.writeFile(path.join(copy, "unsafe.js"), "bad"),
    async (copy: string) => fs.writeFile(path.join(copy, "content/story.md"), "\ufeff" + await fs.readFile(path.join(copy, "content/story.md"), "utf8")),
    async (copy: string) => fs.writeFile(path.join(copy, "content/huge.md"), "a".repeat(256_001)),
    async (copy: string) => fs.writeFile(path.join(copy, "content/invalid.md"), Buffer.from([0xff, 0xfe])),
  ]) {
    await f.generate(); await mutate(f.copy());
    await assert.rejects(f.workspace.approveGeneration(f.approval()));
    assert.equal(await f.manifest(), baseline); assert.equal(await fs.readFile(outside, "utf8"), "untouched");
  }
});

test("failed manifest replacement after temp write preserves baseline and recovery; successful apply ignores later copy changes", async (t) => {
  const f = await setup(t), baseline = await f.manifest();
  await f.generate(); const approval = f.approval();
  const rename = fs.rename;
  const mock = t.mock.method(fs, "rename", async (from: string, to: string) => {
    if (to === path.join(f.site, "bukitjalil.json")) throw new Error("injected replace failure");
    return rename(from, to);
  });
  await assert.rejects(f.workspace.approveGeneration(approval), /injected replace failure/);
  mock.mock.restore();
  assert.equal(await f.manifest(), baseline);
  assert.equal(await fs.readFile(path.join(f.site, ".bukitjalil/recovery", approval.id + ".json"), "utf8"), baseline);
  assert.equal((await fs.readdir(f.site)).filter((n) => n.endsWith(".tmp")).length, 0);
  await f.generate(); const copy = f.copy();
  const late = t.mock.method(fs, "rename", async (from: string, to: string) => {
    if (to === path.join(f.site, "bukitjalil.json"))
      await fs.writeFile(path.join(copy, "content/story.md"), "changed after approval checks").catch(() => {});
    return rename(from, to);
  });
  await f.workspace.approveGeneration(f.approval()); late.mock.restore();
  assert.match(sourceFiles((await ProjectStore.open(f.site)).current())["content/story.md"], /生成副本中的新页面/);
});

test("build failure retains previous successful preview, current source version and restorable history", async (t) => {
  const f = await setup(t);
  await f.workspace.build(); const preview = f.workspace.state().preview!, original = f.workspace.state().project!.currentRevisionId;
  await f.generate(); await fs.writeFile(path.join(f.root, "engine-mode"), "fail");
  await f.workspace.approveGeneration(f.approval());
  assert.equal(f.workspace.state().project!.lastBuild!.status, "failed");
  assert.deepEqual(f.workspace.state().preview, preview);
  assert.notEqual(f.workspace.state().project!.currentRevisionId, preview.revisionId);
  assert.equal((await fetch(preview.url)).status, 200);
  await f.workspace.restore(original);
  assert.equal(f.workspace.state().project!.currentRevisionId, original);
});

test("disposal cancels owned generation, removes its copy and never applies pending reviews", async (t) => {
  const f = await setup(t), baseline = await f.manifest();
  const pending = f.generate("慢生成");
  await until(async () => !!await fs.stat(path.join(f.root, "copy-written")).catch(() => null));
  await f.workspace.dispose(); await pending;
  assert.equal(await f.manifest(), baseline);
  assert.deepEqual(await fs.readdir(path.join(f.data, "generation-copies")), []);
});

test("synthetic Codex → reviewed copy → real Bukit build and new page preview", { skip: !process.env.BUKIT_BIN }, async (t) => {
  const f = await setup(t, true);
  const original = f.workspace.state().project!.currentRevisionId;
  await f.generate(); await f.workspace.approveGeneration(f.approval());
  assert.equal(f.workspace.state().project!.lastBuild!.status, "success", f.workspace.state().project!.lastBuild!.log);
  const preview = f.workspace.state().preview!;
  assert.match(await (await fetch(preview.url)).text(), /来自 AI 的新首页/);
  assert.match(await (await fetch(preview.url + "story/")).text(), /生成副本中的新页面/);
  assert.equal((await fetch(preview.url + "about/")).status, 404);
  await f.workspace.restore(original); await f.workspace.build();
  assert.equal(f.workspace.state().project!.lastBuild!.status, "success");
  assert.match(await (await fetch(f.workspace.state().preview!.url + "about/")).text(), /给好想法一个家/);
});

test("generation refuses missing, enabled or expanded direct-tool configuration before a model turn", async (t) => {
  const f = await setup(t), original = await f.manifest();
  for (const copyMode of [false, { enabled: true, direct_only_tool_namespaces: ["bukitjalil"] },
    { enabled: false, direct_only_tool_namespaces: ["bukitjalil", "functions"] }]) {
    await fs.writeFile(path.join(f.root, "mode.json"), JSON.stringify({ copyMode }));
    await assert.rejects(f.generate(), /未落实只读工具策略/);
    assert.equal(await f.manifest(), original);
  }
  assert.equal((await f.requests()).filter((r) => r.method === "turn/start").length, 0);
});
