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
  assert.equal(reopened.state().project!.currentRevisionId, original);
  assert.match(
    await (await fetch(reopened.state().preview!.url)).text(),
    /让你的想法/,
  );
});

test("cancel terminates a stubborn build, keeps preview and rejects concurrent writes", async (t) => {
  const { workspace, root } = await fixture(t);
  await workspace.build();
  const successfulURL = workspace.state().preview!.url;
  await fs.writeFile(path.join(root, "engine-mode"), "slow");
  const pending = workspace.build();
  await assert.rejects(workspace.editHeadline("concurrent"), /当前操作/);
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
  assert.equal(reopened.state().project!.lastBuild!.status, "interrupted");
  assert.equal((await fetch(reopened.state().preview!.url)).status, 200);
});
