import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CodexChat, type ChatContext } from "../src/main/codex";
import { CodexRpc } from "../src/main/codex-rpc";

async function fixture(mode = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bukitjalil-chat-test-")));
  const binary = path.join(root, "codex");
  await fs.copyFile(new URL("./fixtures/fake-codex.cjs", import.meta.url), binary);
  await fs.chmod(binary, 0o700);
  await fs.writeFile(path.join(root, "mode.json"), JSON.stringify(mode));
  const data = path.join(root, "app"); await fs.mkdir(data);
  let current: ChatContext | null = { path: path.join(root, "site-a"), name: "A", snapshot: { name: "A", files: { "site.yaml": "title: A" } } };
  const urls: string[] = [];
  let service = new CodexChat(data, () => current, () => {}, async (url) => { urls.push(url); }, binary);
  await service.initialize();
  return {
    root, data, binary, urls,
    get service() { return service; },
    get current() { return current!; },
    select(name: string) { current = { path: path.join(root, "site-" + name.toLowerCase()), name, snapshot: { name, files: { "site.yaml": "title: " + name } } }; },
    async reopen() {
      await service.dispose();
      service = new CodexChat(data, () => current, () => {}, async () => {}, binary);
      await service.initialize();
      await until(() => service.state().connection === "ready");
    },
    async requests() {
      return (await fs.readFile(path.join(root, "requests.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    },
    async close() { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); },
  };
}
async function until(check: () => boolean, limit = 4000) {
  const deadline = Date.now() + limit;
  while (!check()) {
    if (Date.now() > deadline) assert.fail("Timed out waiting for protocol state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("isolated project turns stream UTF-8, interrupt the server, fail visibly, and restore after reopening", async () => {
  const f = await fixture();
  try {
    await f.service.connect();
    assert.equal(f.service.state().account?.type, "chatgpt");
    const a = f.current.path;
    await f.service.send({ projectPath: a, text: "慢消息 A" });
    await until(() => f.service.state().conversations[a].messages.some((m) => m.text === "站点建议："));
    f.select("B");
    const b = f.current.path;
    await f.service.send({ projectPath: b, text: "B 的首页" });
    await until(() => f.service.state().conversations[b].status === "completed");
    assert.equal(f.service.state().conversations[a].status, "running");
    assert.ok(!JSON.stringify(f.service.state().conversations[b]).includes("慢消息 A"));
    await f.service.cancel(a);
    await until(() => f.service.state().conversations[a].status === "interrupted");
    await f.service.send({ projectPath: b, text: "失败" });
    await until(() => f.service.state().conversations[b].status === "failed");
    await f.reopen();
    assert.equal(f.service.state().conversations[a].status, "interrupted");
    assert.equal(f.service.state().conversations[b].status, "failed");
    assert.ok(f.service.state().conversations[b].messages.some((m) => m.text === "B 的首页"));
    const requests = await f.requests();
    const starts = requests.filter((r) => r.method === "thread/start");
    assert.equal(starts.length, 2, "reopening resumes the two original threads");
    assert.equal(starts[0].params.historyMode, "legacy");
    assert.notEqual(starts[0].params.cwd, starts[1].params.cwd);
    assert.notEqual(starts[0].params.cwd, a, "Codex never uses the website directory as cwd");
    const turns = requests.filter((r) => r.method === "turn/start");
    assert.equal(turns.length, 3);
    assert.ok(turns[1].params.input[0].text.includes('"name":"B"'));
    assert.ok(!turns[1].params.input[0].text.includes('"name":"A"'));
    assert.deepEqual(turns[0].params.sandboxPolicy, { type: "readOnly", networkAccess: false });
    assert.equal(turns[0].params.approvalPolicy, "never");
    assert.equal(requests.filter((r) => r.method === "turn/interrupt").length, 1);
    await assert.rejects(f.service.send({ projectPath: a, text: "旧页面请求" }), /项目已切换/);
  } finally { await f.close(); }
});

test("lost turn response is reconciled with actual history and is never automatically resent", async () => {
  const f = await fixture();
  try {
    await f.service.connect();
    await assert.rejects(f.service.send({ projectPath: f.current.path, text: "断线" }));
    assert.equal(f.service.state().conversations[f.current.path].status, "unknown");
    await f.service.connect();
    assert.equal(f.service.state().conversations[f.current.path].status, "completed");
    assert.ok(f.service.state().conversations[f.current.path].messages.some((m) => m.text === "已保存的站点建议"));
    assert.equal((await f.requests()).filter((r) => r.method === "turn/start").length, 1);
    await f.reopen();
    assert.equal((await f.requests()).filter((r) => r.method === "turn/start").length, 1);
  } finally { await f.close(); }
});

test("inherited tool policy must be effectively disabled and unsolicited approval is denied", async () => {
  const unsafe = await fixture({ unsafe: true });
  try {
    await assert.rejects(unsafe.service.connect(), /未落实只读工具策略/);
    assert.equal((await unsafe.requests()).filter((r) => r.method === "turn/start").length, 0);
  } finally { await unsafe.close(); }
  const f = await fixture();
  try {
    await f.service.connect();
    await f.service.send({ projectPath: f.current.path, text: "工具" });
    await until(() => f.service.state().conversations[f.current.path].status === "interrupted");
    const reply = (await f.requests()).find((r) => r.id === "approval-1" && r.error);
    assert.equal(reply.error.code, -32601);
  } finally { await f.close(); }
});

test("account state and official login come from protocol; hostile login URLs are rejected", async () => {
  const f = await fixture({ loggedOut: true });
  try {
    await f.service.connect();
    assert.equal(f.service.state().account, null);
    await assert.rejects(f.service.send({ projectPath: f.current.path, text: "hello" }), /登录/);
    await Promise.all([f.service.login(), f.service.login()]);
    assert.equal((await f.requests()).filter((r) => r.method === "account/login/start").length, 1);
    assert.equal(new URL(f.urls[0]).hostname, "auth.openai.com");
    await until(() => f.service.state().account?.type === "chatgpt");
    assert.equal(f.service.state().loginPending, false);
    assert.deepEqual(Object.keys(f.service.state().account!).sort(), ["plan", "type"]);
  } finally { await f.close(); }
  const hostile = await fixture({ loggedOut: true, badLogin: true });
  try {
    await hostile.service.connect();
    await assert.rejects(hostile.service.login(), /不受支持的登录地址/);
    assert.equal(hostile.urls.length, 0);
    assert.equal((await hostile.requests()).filter((r) => r.method === "account/login/cancel").length, 1);
  } finally { await hostile.close(); }
});

test("missing/incompatible Codex and corrupt session indexes fail without overwriting user data", async () => {
  const f = await fixture({ version: "codex-cli 0.1.0" });
  try { assert.equal(f.service.state().connection, "unavailable"); }
  finally { await f.close(); }
  const g = await fixture();
  try {
    await g.service.dispose();
    const file = path.join(g.data, "codex-chats.json");
    await fs.writeFile(file, "broken-index");
    const service = new CodexChat(g.data, () => null, () => {}, async () => {}, "/missing-codex");
    try {
      await service.initialize();
      await assert.rejects(service.connect());
      assert.equal(await fs.readFile(file, "utf8"), "broken-index");
    } finally { await service.dispose(); }
  } finally { await g.close(); }
});

test("transport timeouts and malformed JSON close only the owned child", async () => {
  const f = await fixture();
  const errors: Error[] = [];
  const rpc = new CodexRpc(f.binary, [], f.root, process.env, () => {}, (error) => errors.push(error), 150);
  try {
    await rpc.request("initialize", { clientInfo: { name: "test", version: "1" } });
    rpc.notify("initialized");
    await assert.rejects(rpc.request("timeout"), /超时/);
    assert.equal(errors.length, 1);
    await assert.rejects(rpc.request("account/read"), /未连接/);
  } finally { await rpc.close(); await f.close(); }
  const g = await fixture({ malformed: true });
  try { await assert.rejects(g.service.connect(), /不兼容的协议数据/); }
  finally { await g.close(); }
});
