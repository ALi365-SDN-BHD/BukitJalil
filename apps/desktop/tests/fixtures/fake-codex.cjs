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
const save = () => fs.writeFileSync(historyFile, JSON.stringify(threads));
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
  } else {
    const keys = key.split(".");
    let dest = config;
    for (const part of keys.slice(0, -1)) dest = dest[part] ??= {};
    dest[keys.at(-1)] = JSON.parse(value);
  }
}
if (mode().unsafe) config.mcp_servers.inherited.enabled = true;
let initialized = false, loggedIn = !mode().loggedOut, loginId;
const timers = new Map();
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
  if (!method) return;
  if (method === "initialize") return result(id, { userAgent: "fake-codex", codexHome: root, platformFamily: "unix", platformOs: "macos" });
  if (method === "initialized") { initialized = true; return; }
  if (!initialized) return emit({ id, error: { code: -32001 } });
  if (mode().malformed) { process.stdout.write("not-json\n"); return; }
  if (method === "config/read") return result(id, { config });
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
    const thread = { id: crypto.randomUUID(), cwd: p.cwd, status: { type: "idle" }, turns: [] };
    if (!p.ephemeral) { threads[thread.id] = thread; save(); }
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
    if (question.includes("断线")) {
      turn.items.push({ type: "agentMessage", id: crypto.randomUUID(), text: "已保存的站点建议" });
      turn.status = "completed"; thread.status = { type: "idle" }; save();
      return process.exit(0); // Accepted and completed; response lost. Must never resend.
    }
    result(id, { turn });
    notify("turn/started", { threadId: thread.id, turn });
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
    finish(thread, turn, "interrupted");
    return;
  }
  if (method === "timeout") return;
  return emit({ id, error: { code: -32601 } });
});
process.stdin.on("end", () => process.exit(0));
