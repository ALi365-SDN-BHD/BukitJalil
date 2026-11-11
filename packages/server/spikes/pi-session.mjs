// M1 spike: a full Pi session driven by Pi's faux (scripted) model provider.
// Checks: offline startup, skills in the system prompt and readable through the gate, tool_call
// blocking, sequential execution of bukit tools, event shapes, session files and forking.
// Run: node pi-session.mjs   (from packages/server/spikes, after npm install)
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "bj-pi-session-")));
const home = path.join(root, "home");
const agentDir = path.join(root, "pi");
const worktree = path.join(root, "worktrees", "ai");
const skillsDir = path.join(root, "skills");
const sessionsDir = path.join(root, "sessions");
for (const d of [home, agentDir, worktree, sessionsDir, path.join(skillsDir, "site-editing")]) fs.mkdirSync(d, { recursive: true });
process.env.HOME = home;
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_OFFLINE = "1";
for (const k of Object.keys(process.env)) if (/_API_KEY$|_TOKEN$/.test(k)) delete process.env[k];

fs.writeFileSync(path.join(worktree, "site.yaml"), "site:\n  title: Old\n");
fs.writeFileSync(path.join(home, "secret.txt"), "TOP-SECRET");
const skillPath = path.join(skillsDir, "site-editing", "SKILL.md");
fs.writeFileSync(skillPath, "---\nname: site-editing\ndescription: How to edit a Bukit site in BukitJalil. Use for any site change.\n---\n\n# Site editing\n\nAlways run bukit_check, then bukit_build, then summarize_changes. SKILL-BODY-MARKER\n");

// Any network attempt fails loudly and is recorded.
const netCalls = [];
globalThis.fetch = async (input) => {
  netCalls.push(String(input?.url ?? input));
  throw new Error("network disabled in spike");
};

const pi = await import("@earendil-works/pi-coding-agent");
const ai = await import("@earendil-works/pi-ai");

// ---- gate (compact copy of pi-gate.mjs) ---------------------------------------------------
const realWorktree = fs.realpathSync.native(worktree);
const realSkills = fs.realpathSync.native(skillsDir);
const within = (p, b) => p === b || p.startsWith(b + path.sep);
function resolveReal(abs) {
  let cur = path.resolve(abs);
  const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...tail.reverse()); } catch {
      const parent = path.dirname(cur);
      if (parent === cur) throw new Error(`cannot resolve ${abs}`);
      tail.push(path.basename(cur)); cur = parent;
    }
  }
}
function gate(abs, mode) {
  const real = resolveReal(abs);
  const ok = within(real, realWorktree) || (mode === "read" && within(real, realSkills));
  if (!ok) throw new Error(`outside allowed roots: ${abs}`);
  if (within(real, realWorktree) && path.relative(realWorktree, real).split(path.sep).some((s) => s.toLowerCase() === ".git")) throw new Error(".git is off limits");
  return real;
}

// ---- timing log for ordering checks -------------------------------------------------------
const t0 = performance.now();
const timeline = [];
const mark = (what) => timeline.push({ what, t: Math.round(performance.now() - t0) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const writeTool = pi.createWriteToolDefinition(worktree, {
  operations: {
    writeFile: async (p, c) => { mark("write:start"); await fsp.writeFile(gate(p, "write"), c); mark("write:end"); },
    mkdir: async (d) => fsp.mkdir(gate(d, "write"), { recursive: true }),
  },
});
const readTool = pi.createReadToolDefinition(worktree, {
  operations: { readFile: async (p) => fsp.readFile(gate(p, "read")), access: async (p) => fsp.access(gate(p, "read")) },
});
const grepTool = pi.createGrepToolDefinition(worktree, {
  operations: { isDirectory: async (p) => (await fsp.stat(gate(p, "read"))).isDirectory(), readFile: async (p) => fsp.readFile(gate(p, "read"), "utf-8") },
});
const slowTool = (name, mode) => ({
  name, label: name, description: `Spike tool ${name}`,
  parameters: { type: "object", properties: {} },
  ...(mode ? { executionMode: mode } : {}),
  execute: async () => { mark(`${name}:start`); await sleep(300); mark(`${name}:end`); return { content: [{ type: "text", text: `${name} ok` }], details: undefined }; },
});
const customTools = [readTool, writeTool, grepTool, slowTool("bukit_build", "sequential"), slowTool("slow_a"), slowTool("slow_b")];
const toolNames = ["read", "write", "grep", "bukit_build", "slow_a", "slow_b"];

// ---- tool_call extension ------------------------------------------------------------------
const toolCalls = [];
const gateExtension = {
  name: "bukitjalil-gate",
  factory: (api) => {
    api.on("tool_call", (event) => {
      toolCalls.push({ toolName: event.toolName, input: event.input });
      if (event.toolName === "grep" && !fs.existsSync(path.join(agentDir, "bin", "rg"))) {
        return { block: true, reason: "搜索工具未安装" };
      }
      const p = event.input?.path;
      if (typeof p === "string" && (/^(@|~|file:)/i.test(p) || /[  -​  　]/.test(p))) {
        return { block: true, reason: "路径不允许" };
      }
      return undefined;
    });
  },
};

// ---- faux model ---------------------------------------------------------------------------
const faux = ai.fauxProvider({ provider: "faux", models: [{ id: "faux-1", name: "Faux" }] });
const runtime = await pi.ModelRuntime.create({
  authPath: path.join(agentDir, "auth.json"), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
});
runtime.registerNativeProvider(faux.provider);
const model = faux.getModel();

let firstContext;
faux.setResponses([
  (context) => {
    firstContext = context;
    return ai.fauxAssistantMessage([
      ai.fauxToolCall("read", { path: skillPath }),
      ai.fauxToolCall("grep", { pattern: "Old" }),
      ai.fauxToolCall("read", { path: "~/secret.txt" }),
    ], { stopReason: "toolUse" });
  },
  ai.fauxAssistantMessage([ai.fauxToolCall("slow_a", {}), ai.fauxToolCall("slow_b", {})], { stopReason: "toolUse" }),
  ai.fauxAssistantMessage([ai.fauxToolCall("bukit_build", {}), ai.fauxToolCall("write", { path: "site.yaml", content: "site:\n  title: New\n" })], { stopReason: "toolUse" }),
  ai.fauxAssistantMessage("已把首页标题改成 New。"),
]);

const resourceLoader = new pi.DefaultResourceLoader({
  cwd: worktree, agentDir, additionalSkillPaths: [skillsDir], extensionFactories: [gateExtension],
  noContextFiles: true, noPromptTemplates: true, noThemes: true,
});
await resourceLoader.reload();
const sessionManager = pi.SessionManager.create(worktree, sessionsDir);
const { session } = await pi.createAgentSession({
  cwd: worktree, agentDir, modelRuntime: runtime, model, tools: toolNames, customTools, resourceLoader, sessionManager,
});

const events = [];
session.subscribe((ev) => events.push(ev));
await session.prompt("把首页标题改成 New");
await session.waitForIdle();

// ---- checks -------------------------------------------------------------------------------
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`); cond ? pass++ : fail++; };
const ends = events.filter((e) => e.type === "tool_execution_end");
const resultText = (e) => JSON.stringify(e.result ?? e).slice(0, 160);

console.log(`root: ${root}\n`);
console.log("-- offline / isolation");
ok("no network calls (fetch)", netCalls.length === 0, netCalls.join(", "));
ok("nothing created under $HOME/.pi", !fs.existsSync(path.join(home, ".pi")));
ok("faux model answered all 4 steps", faux.state.callCount === 4, `calls=${faux.state.callCount}`);

console.log("-- skills");
const msgs = firstContext?.messages ?? [];
const sysMsg = msgs.find((m) => m.role === "system" || m.role === "developer");
const sys = [session.systemPrompt, session.agent?.state?.systemPrompt, sysMsg && JSON.stringify(sysMsg.content)].filter((x) => typeof x === "string").join("\n");
if (process.env.DEBUG) console.log("roles:", msgs.map((m) => m.role).join(","), "| session.systemPrompt type:", typeof session.systemPrompt, "| tail:", sys.slice(-600));
ok("system prompt lists the skill and its absolute path", sys.includes("site-editing") && sys.includes(skillPath));
const skillRead = ends.find((e) => e.toolName === "read" && JSON.stringify(e).includes("SKILL-BODY-MARKER"));
ok("model's read of the skill file returns its body", !!skillRead);

console.log("-- tool_call blocking");
const grepEnd = ends.find((e) => e.toolName === "grep");
ok("grep blocked when bin/rg is missing", grepEnd && JSON.stringify(grepEnd).includes("搜索工具未安装"), grepEnd ? resultText(grepEnd) : "no grep end event");
const tildeEnd = ends.find((e) => e.toolName === "read" && JSON.stringify(e).includes("路径不允许"));
ok("read ~/secret.txt blocked in tool_call", !!tildeEnd && !JSON.stringify(events).includes("TOP-SECRET"));

console.log("-- execution order");
const at = (w) => timeline.find((x) => x.what === w)?.t;
ok("control: two normal custom tools run in parallel", at("slow_b:start") < at("slow_a:end"), JSON.stringify(timeline.filter((x) => x.what.startsWith("slow"))));
ok("bukit_build (sequential) finishes before write starts", at("bukit_build:end") <= at("write:start"), `build end=${at("bukit_build:end")} write start=${at("write:start")}`);
ok("write landed", fs.readFileSync(path.join(worktree, "site.yaml"), "utf8").includes("New"));

console.log("-- events");
const types = [...new Set(events.map((e) => e.type))];
console.log("  event types:", types.join(", "));
const pick = (t) => events.find((e) => e.type === t);
for (const t of ["tool_execution_start", "tool_execution_update", "tool_execution_end", "message_update", "message_end", "agent_end", "agent_settled"]) {
  const e = pick(t);
  console.log(`  ${t}: ${e ? Object.keys(e).join(", ") : "(none)"}`);
}
ok("agent_settled emitted once at the end", events.filter((e) => e.type === "agent_settled").length === 1 && events.at(-1)?.type === "agent_settled", `last=${events.at(-1)?.type}`);
const startEv = pick("tool_execution_start");
ok("tool_execution_* carry toolCallId and toolName", !!startEv?.toolCallId && !!startEv?.toolName);

console.log("-- session file and fork");
const file = sessionManager.getSessionFile();
ok("session file written under the custom sessions dir", !!file && file.startsWith(sessionsDir) && fs.existsSync(file), file);
const entries = sessionManager.getEntries();
const firstUser = entries.find((e) => e.type === "message" && e.message?.role === "user");
const branchFile = firstUser ? sessionManager.createBranchedSession(firstUser.id) : undefined;
ok("createBranchedSession(entryId) writes a new, shorter session file", !!branchFile && fs.existsSync(branchFile) && branchFile !== file,
  branchFile ? `${path.basename(branchFile)}: ${fs.readFileSync(branchFile, "utf8").trim().split("\n").length} lines vs ${fs.readFileSync(file, "utf8").trim().split("\n").length}` : "no branch file");
const reopened = pi.SessionManager.open(file, sessionsDir);
ok("session reopens from file with all entries", reopened.getEntries().length === entries.length, `${reopened.getEntries().length}/${entries.length}`);

session.dispose?.();
console.log(`\npassed: ${pass}  failed: ${fail}`);
process.exit(fail ? 1 : 0);
