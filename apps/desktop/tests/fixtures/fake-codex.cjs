#!/usr/bin/env node
// Synthetic protocol peer. Never connects to Codex, an account or a model.
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const crypto = require("node:crypto");
const root = path.dirname(process.argv[1]);
const mode = () => { try { return JSON.parse(fs.readFileSync(path.join(root, "mode.json"), "utf8")); } catch { return {}; } };
if (process.argv.includes("--version")) {
  console.log(mode().version || "codex-cli 0.155.0-test");
  process.exit(0);
}
const historyFile = path.join(root, "threads.json");
let threads = {};
try { threads = JSON.parse(fs.readFileSync(historyFile, "utf8")); } catch {}
const save = () => fs.writeFileSync(historyFile, JSON.stringify(Object.fromEntries(Object.entries(threads).filter(([, t]) => !t.ephemeral))));
const record = (message) => fs.appendFileSync(path.join(root, "requests.jsonl"), JSON.stringify(message) + "\n");
let sequence = Promise.resolve();
const emit = (message) => {
  const bytes = Buffer.from(JSON.stringify(message) + "\n");
  const unicode = bytes.indexOf(Buffer.from("站"));
  const split = unicode < 0 ? Math.min(13, bytes.length) : unicode + 1;
  sequence = sequence.then(() => new Promise((resolve) => {
    process.stdout.write(bytes.subarray(0, split));
    setTimeout(() => { process.stdout.write(bytes.subarray(split)); resolve(); }, 1);
  }));
};
const result = (id, value) => emit({ id, result: value });
const notify = (method, params) => emit({ method, params });
const config = {
  mcp_servers: { inherited: { enabled: true } }, plugins: { "outside@host": { enabled: true } },
  apps: { _default: { enabled: true }, connector: { enabled: true } }, features: {}, notify: ["unsafe-hook"],
};
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] !== "-c") continue;
  const arg = process.argv[++i], split = arg.indexOf("=");
  const key = arg.slice(0, split), value = arg.slice(split + 1);
  if (["mcp_servers", "plugins", "apps"].includes(key)) {
    for (const match of value.matchAll(/"([^"]+)"=\{([^}]+)\}/g)) {
      config[key][match[1]] ??= {};
      for (const field of match[2].split(",")) {
        const [name, v] = field.split("=");
        config[key][match[1]][name] = v === "true";
      }
    }
  } else if (key === "features.code_mode" && value.startsWith("{")) {
    // Only the production direct-tool override uses this TOML table in the synthetic peer.
    config.features.code_mode = { enabled: /enabled=true/.test(value),
      direct_only_tool_namespaces: JSON.parse(value.match(/direct_only_tool_namespaces=(\[[^\]]*\])/)[1]) };
  } else {
    const keys = key.split(".");
    let dest = config;
    for (const part of keys.slice(0, -1)) dest = dest[part] ??= {};
    dest[keys.at(-1)] = JSON.parse(value);
  }
}
if (mode().unsafe) config.mcp_servers.inherited.enabled = true;
if (typeof config.features.code_mode === "object" && mode().copyMode !== undefined)
  config.features.code_mode = mode().copyMode;
let initialized = false, loggedIn = !mode().loggedOut, loginId;
const timers = new Map();
const pendingTools = new Map();
const threadReply = (thread) => ({
  thread, sandbox: { type: "readOnly", networkAccess: false },
  approvalPolicy: "never", approvalsReviewer: "user",
});
const finish = (thread, turn, status) => {
  clearTimeout(timers.get(thread.id));
  turn.status = status; thread.status = { type: "idle" }; save();
  notify("turn/completed", { threadId: thread.id, turn });
};
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  record(message);
  const { id, method, params: p = {} } = message;
  if (!method) { pendingTools.get(id)?.(message); pendingTools.delete(id); return; }
  if (method === "initialize") return result(id, { userAgent: "fake-codex", codexHome: root, platformFamily: "unix", platformOs: "macos" });
  if (method === "initialized") { initialized = true; return; }
  if (!initialized) return emit({ id, error: { code: -32001 } });
  if (mode().malformed) { process.stdout.write("not-json\n"); return; }
  if (method === "config/read") return result(id, { config });
  if (method === "model/list") return result(id, { data: mode().models ?? [
    { model: "synthetic-sol", displayName: "Synthetic Sol", hidden: false, isDefault: true, defaultReasoningEffort: "low",
      supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }, { reasoningEffort: "high", description: "Deep" }] },
    { model: "synthetic-hidden", displayName: "Hidden", hidden: true, isDefault: false, defaultReasoningEffort: "low", supportedReasoningEfforts: [] },
  ], nextCursor: null });
  if (method === "account/read") return result(id, {
    account: loggedIn ? { type: "chatgpt", planType: "plus" } : null, requiresOpenaiAuth: true,
  });
  if (method === "account/login/start") {
    loginId = crypto.randomUUID();
    result(id, { type: "chatgpt", loginId, authUrl: mode().badLogin ? "https://attacker.invalid/login" : "https://auth.openai.com/authorize?synthetic=1" });
    if (!mode().badLogin) setTimeout(() => {
      loggedIn = true;
      notify("account/login/completed", { loginId, success: true });
    }, 150);
    return;
  }
  if (method === "account/login/cancel") return result(id, { status: "canceled" });
  if (method === "mcpServerStatus/list") return result(id, {
    data: [{ name: "inherited", tools: config.mcp_servers.inherited.enabled ? { write: {} } : {}, resources: [], resourceTemplates: [] }], nextCursor: null,
  });
  if (method === "thread/start") {
    const thread = { id: crypto.randomUUID(), cwd: p.cwd, status: { type: "idle" }, turns: [], ephemeral: !!p.ephemeral, dynamicTools: p.dynamicTools };
    threads[thread.id] = thread; save();
    return result(id, threadReply(thread));
  }
  const thread = threads[p.threadId];
  if (method === "thread/read" || method === "thread/resume") {
    if (!thread) return emit({ id, error: { code: -32002 } });
    return result(id, method === "thread/read" ? { thread } : threadReply(thread));
  }
  if (method === "turn/start") {
    const input = p.input[0].text;
    const question = JSON.parse(input.slice(input.indexOf("\n") + 1)).question;
    const turn = { id: crypto.randomUUID(), status: "inProgress", items: [
      { type: "userMessage", id: crypto.randomUUID(), content: p.input },
    ] };
    thread.turns.push(turn); thread.status = { type: "active" }; save();
    if (question.includes("断线") && !thread.ephemeral) {
      turn.items.push({ type: "agentMessage", id: crypto.randomUUID(), text: "已保存的站点建议" });
      turn.status = "completed"; thread.status = { type: "idle" }; save();
      return process.exit(0); // Accepted and completed; response lost. Must never resend.
    }
    result(id, { turn });
    notify("turn/started", { threadId: thread.id, turn });
    if (thread.ephemeral) {
      const files = JSON.parse(input.slice(input.indexOf("\n") + 1)).files;
      const edits = [
        { path: "site.yaml", content: files["site.yaml"].replace(/^  title: .+$/m, '  title: "来自 AI 的新首页"') },
        { path: "content/about.md", content: null },
        { path: "content/story.md", content: "---\ntitle: 新故事\nslug: story\ntype: page\ncollection: page\npublishAt: 2026-01-01T00:00:00Z\n---\n生成副本中的新页面。\n" },
        { path: "themes/canopy/layouts/pages/index.html", content: files["themes/canopy/layouts/pages/index.html"] + "\n<!-- 来自生成副本 -->\n" },
      ];
      if (question.includes("越界")) edits.push({ path: "../outside", content: "bad" });
      if (question.includes("构建错误")) edits[3].content = "{{ if }}";
      const callId = crypto.randomUUID();
      pendingTools.set(callId, (reply) => {
        if (!reply.result?.success) return finish(thread, turn, "failed");
        fs.writeFileSync(path.join(root, "copy-written"), thread.cwd);
        if (question.includes("断线")) return process.exit(0);
        notify("item/agentMessage/delta", { threadId: thread.id, turnId: turn.id, itemId: callId + "-text", delta: "已在副本中修改首页，删除关于页并新增故事页。" });
        timers.set(thread.id, setTimeout(() => finish(thread, turn, question.includes("失败") ? "failed" : "completed"), question.includes("慢") ? 10_000 : 30));
      });
      emit({ id: callId, method: question.includes("提权") ? "item/commandExecution/requestApproval" : "item/tool/call",
        params: { threadId: question.includes("跨任务") ? "wrong-thread" : thread.id, turnId: turn.id, callId,
          namespace: question.includes("跨命名空间") ? "outside" : thread.dynamicTools?.[0]?.name, tool: "edit_website_copy", arguments: { files: edits } } });
      return;
    }
    if (/^(?:生成一个新首页|请修改网站|再改一次)/.test(question) &&
        thread.dynamicTools?.[0]?.tools?.[0]?.name === "request_website_edit") {
      const callId = crypto.randomUUID();
      pendingTools.set(callId, (reply) => {
        if (reply.error) return;
        const answer = reply.result?.success ? "修改副本已就绪，请审核后保存。" : "请先处理当前待审核的副本，再提出新的修改。";
        const item = { type: "agentMessage", id: crypto.randomUUID(), text: answer };
        turn.items.push(item); save();
        notify("item/completed", { threadId: thread.id, turnId: turn.id, item });
        finish(thread, turn, "completed");
      });
      emit({ id: callId, method: "item/tool/call", params: { threadId: thread.id, turnId: turn.id,
        callId, namespace: "bukitjalil", tool: "request_website_edit",
        arguments: question.includes("越权参数") ? { files: [] } : {} } });
      return;
    }
    const item = { type: "agentMessage", id: crypto.randomUUID(), text: "站点建议：" + question };
    thread.turns.at(-1).items.push(item); save();
    notify("item/agentMessage/delta", { threadId: thread.id, turnId: turn.id, itemId: item.id, delta: "站点建议：" });
    if (question.includes("工具")) {
      emit({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId: thread.id, turnId: turn.id } });
    }
    timers.set(thread.id, setTimeout(() => {
      notify("item/agentMessage/delta", { threadId: thread.id, turnId: turn.id, itemId: item.id, delta: question });
      notify("item/completed", { threadId: thread.id, turnId: turn.id, item });
      finish(thread, turn, question.includes("失败") ? "failed" : "completed");
    }, question.includes("慢") || question.includes("工具") ? 10_000 : 80));
    return;
  }
  if (method === "turn/interrupt") {
    const turn = thread.turns.find((t) => t.id === p.turnId);
    result(id, {});
    if (mode().slowInterrupt) setTimeout(() => finish(thread, turn, "interrupted"), 180);
    else finish(thread, turn, "interrupted");
    return;
  }
  if (method === "timeout") return;
  return emit({ id, error: { code: -32601 } });
});
process.stdin.on("end", () => process.exit(0));
