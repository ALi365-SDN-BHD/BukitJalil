import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../src/main/workspace";
import { withSiteInfo } from "../src/main/site-config";

test(
  "real Bukit: sample theme, edit, restore, restart and preview cleanup",
  { skip: !process.env.BUKIT_BIN },
  async (t) => {
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "bukitjalil-real-")),
    );
    let workspace = new Workspace(path.join(root, "app"));
    t.after(async () => {
      await workspace.dispose();
      await fs.rm(root, { recursive: true, force: true });
    });
    await workspace.initialize(process.env.BUKIT_BIN);
    await workspace.create(path.join(root, "site"), "真实构建验证");
    await workspace.applyTheme();
    const original = workspace.state().project!.currentRevisionId;
    await workspace.build();
    assert.equal(
      workspace.state().project!.lastBuild!.status,
      "success",
      JSON.stringify(workspace.state()),
    );
    const url = workspace.state().preview!.url;
    assert.match(await (await fetch(url)).text(), /让你的想法/);
    assert.match(await (await fetch(`${url}about/`)).text(), /给好想法一个家/);
    assert.equal((await fetch(`${url}assets/style.css`)).status, 200);
    const configPath = path.join(root, "site", "site.yaml");
    const advanced = withSiteInfo(await fs.readFile(configPath, "utf8"), "编辑器中的标题", "编辑器中的简介") +
      "logging:\n  level: warn\n";
    await fs.writeFile(configPath, advanced);
    await workspace.build();
    assert.equal(workspace.state().project!.lastBuild!.status, "success");
    assert.equal(await fs.readFile(configPath, "utf8"), advanced);
    assert.equal(workspace.state().project!.revisions.at(-1)!.summary, "导入外部 site.yaml 修改");
    assert.match(await (await fetch(workspace.state().preview!.url)).text(), /编辑器中的标题/);
    await workspace.editHeadline('A "quoted" <标题> & 新开始');
    await workspace.build();
    assert.equal(
      workspace.state().project!.lastBuild!.status,
      "success",
      workspace.state().project!.lastBuild!.log,
    );
    assert.match(
      await (await fetch(workspace.state().preview!.url)).text(),
      /&lt;标题&gt; &amp; 新开始/,
    );
    await workspace.restore(original);
    await workspace.build();
    assert.equal(workspace.state().project!.lastBuild!.status, "success");
    const lastURL = workspace.state().preview!.url;
    await workspace.dispose();
    await assert.rejects(fetch(lastURL));
    workspace = new Workspace(path.join(root, "app"));
    await workspace.initialize();
    assert.equal(workspace.state().project, null);
    await workspace.openRecent(workspace.state().recent[0].id);
    assert.equal(workspace.state().project!.currentRevisionId, original);
    assert.match(
      await (await fetch(workspace.state().preview!.url)).text(),
      /让你的想法/,
    );
  },
);
