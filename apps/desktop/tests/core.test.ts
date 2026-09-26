import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../src/main/workspace";
import {
  ProjectStore,
  validateProject,
  manifestFile,
} from "../src/main/project";
import { scopedPath, atomicWrite } from "../src/main/files";
import { sampleTheme } from "../src/main/theme";
import { ManagedProcess } from "../src/main/process";
import { keepOnlyProposedTitle, withSiteInfo } from "../src/main/site-config";
import { siteConfig } from "../src/main/theme";

async function fixture(t: test.TestContext) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bukitjalil-test-")),
  );
  const binary = path.join(root, "bukit");
  await fs.copyFile(
    new URL("./fixtures/fake-bukit.cjs", import.meta.url),
    binary,
  );
  await fs.chmod(binary, 0o700);
  const workspace = new Workspace(path.join(root, "app"));
  await workspace.initialize(binary);
  t.after(async () => {
    await workspace.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });
  await workspace.create(path.join(root, "site"), "测试项目");
  await workspace.applyTheme();
  return { root, binary, workspace };
}

test("project → theme copy → build → edit → failure keeps preview → restore → restart", async (t) => {
  const { workspace, root } = await fixture(t);
  const original = workspace.state().project!.currentRevisionId;
  await workspace.build();
  assert.equal(workspace.state().project!.lastBuild!.status, "success");
  const firstPreview = workspace.state().preview!;
  assert.match(await (await fetch(firstPreview.url)).text(), /让你的想法/);
  await workspace.editHeadline('A "quoted" <title> & 中文');
  await workspace.build();
  assert.match(
    await (await fetch(workspace.state().preview!.url)).text(),
    /&lt;title&gt; &amp; 中文/,
  );
  const lastGood = workspace.state().preview!;
  await workspace.editHeadline("失败的新修改");
  await fs.writeFile(path.join(root, "engine-mode"), "fail");
  await workspace.build();
  assert.equal(workspace.state().project!.lastBuild!.status, "failed");
  assert.equal(workspace.state().preview!.url, lastGood.url);
  assert.notEqual(
    workspace.state().preview!.revisionId,
    workspace.state().project!.currentRevisionId,
  );
  assert.match(
    workspace.state().project!.lastBuild!.log,
    /synthetic build failure/,
  );
  await fs.writeFile(path.join(root, "engine-mode"), "");
  await workspace.restore(original);
  await workspace.build();
  assert.match(
    await (await fetch(workspace.state().preview!.url)).text(),
    /让你的想法/,
  );
  assert.equal(workspace.state().project!.revisions.length, 4);
  const finalURL = workspace.state().preview!.url;
  await workspace.dispose();
  await assert.rejects(fetch(finalURL));
  const reopened = new Workspace(path.join(root, "app"));
  t.after(() => reopened.dispose());
  await reopened.initialize();
  assert.equal(reopened.state().project, null);
  assert.equal(reopened.state().preview, null);
  await reopened.openRecent(reopened.state().recent[0].id);
  assert.equal(reopened.state().project!.currentRevisionId, original);
  assert.match(
    await (await fetch(reopened.state().preview!.url)).text(),
    /让你的想法/,
  );
});

test("persistent site.yaml imports external edits, preserves extra fields, restores snapshots and rejects conflicts", async (t) => {
  const { workspace, root } = await fixture(t);
  const filename = path.join(root, "site/site.yaml");
  const initial = await fs.readFile(filename, "utf8");
  const originalId = workspace.state().project!.currentRevisionId;
  const external = withSiteInfo(initial, "外部标题", "外部简介") + "logging:\n  level: warn\n";
  await fs.writeFile(filename, external);
  await workspace.build();
  const imported = workspace.state().project!;
  assert.equal(imported.revisions.length, 3);
  assert.equal(imported.revisions.at(-1)!.summary, "导入外部 site.yaml 修改");
  assert.equal(imported.revisions.at(-1)!.headline, "外部标题");
  assert.equal(await fs.readFile(filename, "utf8"), external);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, "site/bukitjalil.json"), "utf8")).format, 2);
  assert.match(keepOnlyProposedTitle(external, siteConfig("AI 标题")), /level: warn/);
  await workspace.saveSiteInfo({ title: "内部标题", description: "内部简介", revisionId: imported.currentRevisionId });
  assert.match(await fs.readFile(filename, "utf8"), /level: warn/);
  await workspace.restore(originalId);
  assert.equal(await fs.readFile(filename, "utf8"), initial);
  await workspace.restore(imported.currentRevisionId);
  assert.equal(await fs.readFile(filename, "utf8"), external);
  const preview = workspace.state().preview!.url;
  const invalid = external.replace(/title: .+/, "title: [bad]");
  await fs.writeFile(filename, invalid);
  await assert.rejects(workspace.build(), /site.yaml/);
  assert.equal(await fs.readFile(filename, "utf8"), invalid);
  assert.equal(workspace.state().preview!.url, preview);
  const staleId = workspace.state().project!.currentRevisionId;
  await fs.writeFile(filename, withSiteInfo(external, "又一次外部修改", "外部简介"));
  await assert.rejects(workspace.saveSiteInfo({ title: "不应覆盖", description: "本地", revisionId: staleId }), /配置已变化/);
  assert.match(await fs.readFile(filename, "utf8"), /又一次外部修改/);
});

test("Bukit path reports a version and rejects invalid replacements without losing the saved engine", async (t) => {
  const { workspace, root, binary } = await fixture(t);
  assert.equal(workspace.state().binaryVersion, "bukit 2.0.0-test");
  await assert.rejects(workspace.chooseEngine("relative/bukit"), /绝对路径/);
  await assert.rejects(workspace.chooseEngine(path.join(root, "missing")));
  assert.equal(workspace.state().binary, binary);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, "app/session.json"), "utf8")).binary, binary);
});

test("cancel terminates a stubborn build, keeps preview and rejects concurrent writes", async (t) => {
  const { workspace, root } = await fixture(t);
  await workspace.build();
  const successfulURL = workspace.state().preview!.url;
  await fs.writeFile(path.join(root, "engine-mode"), "slow");
  const pending = workspace.build();
  await assert.rejects(workspace.editHeadline("concurrent"), /当前操作/);
  await assert.rejects(workspace.home(), /当前操作/);
  await assert.rejects(workspace.renameProject({ id: workspace.state().recent[0].id, name: "blocked" }), /当前操作/);
  await assert.rejects(workspace.removeProject(workspace.state().recent[0].id), /当前操作/);
  const pidFile = path.join(root, "build.pid");
  for (let i = 0; i < 200; i++) {
    if (await fs.stat(pidFile).catch(() => null)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const pid = Number(await fs.readFile(pidFile, "utf8"));
  await workspace.cancel();
  await pending;
  assert.equal(workspace.state().project!.lastBuild!.status, "cancelled");
  assert.throws(() => process.kill(pid, 0));
  assert.equal(workspace.state().preview!.url, successfulURL);
  assert.equal((await fetch(successfulURL)).status, 200);
});

test("disposal while building reaps process and preview", async (t) => {
  const { workspace, root } = await fixture(t);
  await workspace.build();
  const url = workspace.state().preview!.url;
  await fs.writeFile(path.join(root, "engine-mode"), "slow");
  const pending = workspace.build();
  await workspace.dispose();
  await pending;
  await assert.rejects(fetch(url));
  assert.equal(workspace.state().project!.lastBuild!.status, "cancelled");
});

test("process cleanup reaps descendants after their leader has exited", async (t) => {
  const { root } = await fixture(t);
  const script = `const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.once('data', () => { console.log(child.pid); process.exit(0); });`;
  let output = "";
  const child = new ManagedProcess(
    process.execPath,
    ["-e", script],
    root,
    (text) => {
      output += text;
    },
  );
  t.after(() => child.stop());
  await child.done;
  const descendant = Number(output.trim());
  assert.ok(descendant > 0);
  await child.stop();
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(descendant, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("descendant still running after cleanup");
});

test("scoped files reject traversal, symlink and hardlink, without touching outside files", async (t) => {
  const { workspace, root } = await fixture(t);
  const project = workspace.state().project!.path;
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "keep"), "untouched");
  await assert.rejects(scopedPath(project, "../outside/keep"));
  await fs.symlink(outside, path.join(project, "link"));
  await assert.rejects(atomicWrite(project, "link/keep", "bad"), /链接/);
  await fs.link(path.join(outside, "keep"), path.join(project, "hardlink"));
  await assert.rejects(atomicWrite(project, "hardlink", "bad"), /链接/);
  await fs.symlink(outside, path.join(project, ".bukitjalil"));
  await workspace.build();
  assert.equal(workspace.state().project!.lastBuild!.status, "failed");
  assert.equal(
    await fs.readFile(path.join(outside, "keep"), "utf8"),
    "untouched",
  );
  assert.deepEqual(await fs.readdir(outside), ["keep"]);
});

test("invalid project data and external modifications fail without overwrite", async (t) => {
  const { workspace } = await fixture(t);
  const root = workspace.state().project!.path;
  const store = await ProjectStore.open(root);
  const data = structuredClone(store.data);
  data.revisions[0].id = "../../outside";
  assert.throws(() => validateProject(data));
  data.revisions = store.data.revisions;
  const changedTheme = structuredClone(store.data);
  changedTheme.revisions[1].theme!.files["../../escape"] = "bad";
  assert.throws(() => validateProject(changedTheme));
  await assert.rejects(workspace.editHeadline("bad\nline"));
  const filename = path.join(root, manifestFile);
  await fs.writeFile(filename, "external edit");
  await assert.rejects(workspace.editHeadline("new"), /其他程序修改/);
  assert.equal(await fs.readFile(filename, "utf8"), "external edit");
  await assert.rejects(ProjectStore.create(root, "existing"));
});

test("theme copies do not share mutable library or other projects", async (t) => {
  const { workspace, root } = await fixture(t);
  const first = await ProjectStore.open(workspace.state().project!.path);
  const copied = first.current().theme!;
  copied.files["themes/canopy/layouts/pages/index.html"] =
    "a local customization";
  await first.save(first.data);
  await workspace.create(path.join(root, "second"), "第二个项目");
  await workspace.applyTheme();
  const second = await ProjectStore.open(workspace.state().project!.path);
  assert.notEqual(
    second.current().theme!.files["themes/canopy/layouts/pages/index.html"],
    copied.files["themes/canopy/layouts/pages/index.html"],
  );
  assert.deepEqual(second.current().theme, sampleTheme());
});

test("interrupted build records recover without deleting successful output", async (t) => {
  const { workspace, root } = await fixture(t);
  await workspace.build();
  const store = await ProjectStore.open(workspace.state().project!.path);
  await workspace.dispose();
  await store.save({
    ...store.data,
    lastBuild: { ...store.data.lastBuild!, status: "running" },
  });
  const reopened = new Workspace(path.join(root, "app"));
  t.after(() => reopened.dispose());
  await reopened.initialize();
  assert.equal(reopened.state().project, null);
  assert.equal(reopened.state().preview, null);
  await reopened.openRecent(reopened.state().recent[0].id);
  assert.equal(reopened.state().project!.lastBuild!.status, "interrupted");
  assert.equal((await fetch(reopened.state().preview!.url)).status, 200);
});


test("project home persists names and open times; returning stops preview; removing only drops the index", async (t) => {
  const { workspace, root } = await fixture(t);
  await workspace.build();
  const recent = workspace.state().recent[0], filename = path.join(recent.path, manifestFile);
  assert.ok(Number.isFinite(Date.parse(recent.lastOpenedAt!)));
  const before = JSON.parse(await fs.readFile(filename, "utf8"));
  const url = workspace.state().preview!.url;
  await workspace.home();
  assert.equal(workspace.state().project, null);
  assert.equal(workspace.chatContext(), null);
  assert.equal(workspace.state().preview, null);
  await assert.rejects(fetch(url));
  assert.deepEqual(JSON.parse(await fs.readFile(filename, "utf8")), before);
  await workspace.renameProject({ id: recent.id, name: "新的项目名称" });
  assert.deepEqual(JSON.parse(await fs.readFile(filename, "utf8")), { ...before, name: "新的项目名称" });
  assert.equal(workspace.state().recent[0].lastOpenedAt, recent.lastOpenedAt);
  assert.equal(workspace.state().recent[0].path, recent.path);
  await workspace.dispose();
  const reopened = new Workspace(path.join(root, "app")); t.after(() => reopened.dispose());
  await reopened.initialize();
  assert.equal(reopened.state().project, null);
  assert.equal(reopened.state().preview, null);
  assert.equal(reopened.state().recent[0].name, "新的项目名称");
  assert.equal(reopened.state().recent[0].lastOpenedAt, recent.lastOpenedAt);
  const openingAt = Date.now();
  await reopened.openRecent(recent.id);
  assert.ok(Date.parse(reopened.state().recent[0].lastOpenedAt!) >= openingAt);
  assert.equal(reopened.state().project!.currentRevisionId, before.currentRevisionId);
  await assert.rejects(reopened.removeProject(recent.id), /返回项目首页/);
  await reopened.home();
  const saved = await fs.readFile(filename, "utf8"), files = await fs.readdir(recent.path);
  await reopened.removeProject(recent.id);
  assert.deepEqual(reopened.state().recent, []);
  assert.equal(await fs.readFile(filename, "utf8"), saved);
  assert.deepEqual(await fs.readdir(recent.path), files);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "app/session.json"), "utf8")).recent, []);
  await reopened.open(recent.path);
  assert.equal(reopened.state().project!.name, "新的项目名称");
  assert.equal(reopened.state().recent[0].path, recent.path);
});

test("legacy timestamps remain unknown and unavailable projects can be removed without opening or deleting them", async (t) => {
  const { workspace, root } = await fixture(t);
  await workspace.dispose();
  const index = path.join(root, "app/session.json");
  const saved = JSON.parse(await fs.readFile(index, "utf8"));
  const existing = saved.recent[0]; delete existing.lastOpenedAt;
  const missing = { id: crypto.randomUUID(), name: "已移动项目", path: path.join(root, "missing") };
  saved.recent.push(missing);
  const originalIndex = JSON.stringify(saved); await fs.writeFile(index, originalIndex);
  const originalProject = await fs.readFile(path.join(existing.path, manifestFile), "utf8");
  const reopened = new Workspace(path.join(root, "app")); t.after(() => reopened.dispose());
  await reopened.initialize();
  assert.equal(reopened.state().project, null);
  assert.equal(reopened.state().recent[0].lastOpenedAt, undefined);
  assert.equal(reopened.state().recent[0].unavailable, null);
  assert.match(reopened.state().recent[1].unavailable!, /找不到项目/);
  assert.equal(await fs.readFile(index, "utf8"), originalIndex);
  assert.equal(await fs.readFile(path.join(existing.path, manifestFile), "utf8"), originalProject);
  await assert.rejects(reopened.openRecent(missing.id), /找不到项目/);
  assert.equal(reopened.state().project, null);
  await reopened.removeProject(missing.id);
  await assert.rejects(fs.stat(missing.path), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(existing.path, manifestFile), "utf8"), originalProject);
  await reopened.openRecent(existing.id);
  assert.ok(reopened.state().recent[0].lastOpenedAt);
});

test("invalid names and index write failures preserve files and report partial rename truthfully", async (t) => {
  const { workspace, root } = await fixture(t);
  await workspace.home();
  const recent = workspace.state().recent[0], filename = path.join(recent.path, manifestFile);
  const original = await fs.readFile(filename, "utf8");
  await assert.rejects(workspace.renameProject({ id: recent.id, name: "bad\nname" }), /单行文字/);
  await assert.rejects(workspace.renameProject({ id: "../../outside", name: "bad" }), /不在列表/);
  await assert.rejects(workspace.removeProject("../../outside"), /不在列表/);
  assert.equal(await fs.readFile(filename, "utf8"), original);
  const index = path.join(root, "app/session.json");
  await fs.rename(index, index + ".saved"); await fs.mkdir(index);
  await assert.rejects(workspace.removeProject(recent.id));
  assert.deepEqual(workspace.state().recent, [recent]);
  assert.equal(await fs.readFile(filename, "utf8"), original);
  await assert.rejects(workspace.renameProject({ id: recent.id, name: "已保存的名称" }), /项目名称已保存，但列表更新失败/);
  assert.deepEqual(JSON.parse(await fs.readFile(filename, "utf8")), { ...JSON.parse(original), name: "已保存的名称" });
  assert.equal(workspace.state().recent[0].name, "已保存的名称");
  assert.ok((await fs.stat(index)).isDirectory());
  assert.deepEqual((await fs.readdir(path.join(root, "app"))).filter((entry) => entry.endsWith(".tmp")), []);
});
