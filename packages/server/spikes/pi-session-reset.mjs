// M1 spike: keep using one Pi session file after the worktree is reset to a new main.
// The model remembers content that no longer exists; check what the tools do and that the
// session (in memory and reopened from its file) keeps working.
// Run: node pi-session-reset.mjs   (from packages/server/spikes, after npm install)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "bj-pi-reset-")));
const agentDir = path.join(root, "pi");
const worktree = path.join(root, "worktrees", "ai");
const sessionsDir = path.join(root, "sessions");
for (const d of [agentDir, worktree, sessionsDir]) fs.mkdirSync(d, { recursive: true });
process.env.HOME = root;
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_OFFLINE = "1";
globalThis.fetch = async () => { throw new Error("network disabled in spike"); };

const pi = await import("@earendil-works/pi-coding-agent");
const ai = await import("@earendil-works/pi-ai");
const site = path.join(worktree, "site.yaml");
fs.writeFileSync(site, "site:\n  title: Old\n");

const faux = ai.fauxProvider({ provider: "faux", models: [{ id: "faux-1", name: "Faux" }] });
const runtime = await pi.ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
runtime.registerNativeProvider(faux.provider);
const model = faux.getModel();
const tools = ["read", "edit", "write"];
const customTools = [pi.createReadToolDefinition(worktree), pi.createEditToolDefinition(worktree), pi.createWriteToolDefinition(worktree)];

async function open(sessionManager) {
  const resourceLoader = new pi.DefaultResourceLoader({ cwd: worktree, agentDir, noContextFiles: true, noPromptTemplates: true, noThemes: true, noSkills: true });
  await resourceLoader.reload();
  const { session } = await pi.createAgentSession({ cwd: worktree, agentDir, modelRuntime: runtime, model, tools, customTools, resourceLoader, sessionManager });
  const events = [];
  session.subscribe((e) => events.push(e));
  return { session, events };
}
const edit = (oldText, newText) => ai.fauxToolCall("edit", { path: "site.yaml", edits: [{ oldText, newText }] });
const ends = (events) => events.filter((e) => e.type === "tool_execution_end");
let seen;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`); cond ? pass++ : fail++; };

// Change set 1: Old -> New
const sm = pi.SessionManager.create(worktree, sessionsDir);
const a = await open(sm);
faux.setResponses([ai.fauxAssistantMessage([edit("title: Old", "title: New")], { stopReason: "toolUse" }), ai.fauxAssistantMessage("改好了。")]);
await a.session.prompt("把标题改成 New");
await a.session.waitForIdle();
ok("change set 1 edit applied", fs.readFileSync(site, "utf8").includes("title: New"));

// Change set 1 is discarded; the worktree is reset to a new main with a different title.
fs.writeFileSync(site, "site:\n  title: Main2\n");

// Same in-memory session: the model still thinks the title is New.
faux.setResponses([
  ai.fauxAssistantMessage([edit("title: New", "title: Newer")], { stopReason: "toolUse" }),
  (ctx) => { seen = ctx; return ai.fauxAssistantMessage([ai.fauxToolCall("read", { path: "site.yaml" })], { stopReason: "toolUse" }); },
  ai.fauxAssistantMessage([edit("title: Main2", "title: Newer")], { stopReason: "toolUse" }),
  ai.fauxAssistantMessage("改好了。"),
]);
await a.session.prompt("再把标题改成 Newer");
await a.session.waitForIdle();
const staleEdit = ends(a.events).filter((e) => e.toolName === "edit").at(-2);
ok("edit with stale oldText fails as a tool error, file untouched", staleEdit?.isError === true, JSON.stringify(staleEdit?.result).slice(0, 140));
ok("model context after the failure still holds change set 1 messages", JSON.stringify(seen?.messages ?? []).includes("把标题改成 New"));
ok("after re-reading, the edit lands on the reset content", fs.readFileSync(site, "utf8").includes("title: Newer"));
const file = sm.getSessionFile();
a.session.dispose?.();

// Reopen the same session file in a new session object (e.g. after a server restart).
fs.writeFileSync(site, "site:\n  title: Main3\n");
const b = await open(pi.SessionManager.open(file, sessionsDir));
faux.setResponses([
  (ctx) => { seen = ctx; return ai.fauxAssistantMessage([ai.fauxToolCall("read", { path: "site.yaml" })], { stopReason: "toolUse" }); },
  ai.fauxAssistantMessage("现在的标题是 Main3。"),
]);
await b.session.prompt("现在标题是什么？");
await b.session.waitForIdle();
ok("reopened session sends the full history to the model", JSON.stringify(seen?.messages ?? []).includes("再把标题改成 Newer"));
const readEnd = ends(b.events).find((e) => e.toolName === "read");
ok("read in the reopened session returns the current file", JSON.stringify(readEnd?.result ?? "").includes("Main3"));
ok("all turns appended to the same session file", pi.SessionManager.open(file, sessionsDir).getEntries().filter((e) => e.message?.role === "user").length === 3);

b.session.dispose?.();
console.log(`\npassed: ${pass}  failed: ${fail}  (root: ${root})`);
process.exit(fail ? 1 : 0);
