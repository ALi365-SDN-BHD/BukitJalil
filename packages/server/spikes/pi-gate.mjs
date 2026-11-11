// M1 spike: enforce the path gate inside Pi tool `operations`, after Pi's own path normalization.
// Run: node pi-gate.mjs   (from packages/server/spikes, after npm install)
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Sandbox HOME / agent dir before Pi is loaded, so `~` expands into a throwaway dir.
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "bj-pi-gate-")));
const home = path.join(root, "home");
const agentDir = path.join(root, "pi");
const worktree = path.join(root, "worktrees", "ai");
const skillsDir = path.join(root, "skills");
const outside = path.join(root, "outside");
for (const d of [home, agentDir, worktree, skillsDir, outside, path.join(worktree, ".git-dir")]) fs.mkdirSync(d, { recursive: true });
process.env.HOME = home;
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_OFFLINE = "1";

const SECRET = "TOP-SECRET-VALUE";
fs.writeFileSync(path.join(home, "secret.txt"), SECRET);
fs.writeFileSync(path.join(outside, "secret.txt"), SECRET);
fs.writeFileSync(path.join(outside, "a b.txt"), SECRET);
fs.writeFileSync(path.join(worktree, "index.md"), "# hello\n");
fs.writeFileSync(path.join(worktree, ".git"), "gitdir: /somewhere\n");
fs.mkdirSync(path.join(worktree, "content", ".GIT"), { recursive: true });
fs.writeFileSync(path.join(worktree, "content", ".GIT", "config"), "x");
fs.symlinkSync(path.join(outside, "secret.txt"), path.join(worktree, "link.md"));
fs.symlinkSync(outside, path.join(worktree, "linkdir"));
fs.mkdirSync(path.join(skillsDir, "site-editing"));
fs.writeFileSync(path.join(skillsDir, "site-editing", "SKILL.md"), "# skill\n");

const pi = await import("@earendil-works/pi-coding-agent");

// ---- the gate (prototype of packages/server/src/agent/gate.ts) --------------------------
class GateError extends Error {}
const realWorktree = fs.realpathSync.native(worktree);
const realSkills = fs.realpathSync.native(skillsDir);
const within = (p, base) => p === base || p.startsWith(base + path.sep);

// Resolve the deepest existing ancestor with realpath, then re-append the missing tail.
function resolveReal(abs) {
  let cur = path.resolve(abs);
  const tail = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(cur);
      return path.join(real, ...tail.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) throw new GateError(`cannot resolve ${abs}`);
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}
function gate(abs, mode /* "read" | "write" */) {
  if (!path.isAbsolute(abs)) throw new GateError(`not absolute: ${abs}`);
  const real = resolveReal(abs);
  const inWorktree = within(real, realWorktree);
  const inSkills = within(real, realSkills);
  if (!inWorktree && !(mode === "read" && inSkills)) throw new GateError(`outside allowed roots: ${abs} -> ${real}`);
  if (inWorktree) {
    const rel = path.relative(realWorktree, real);
    if (rel.split(path.sep).some((seg) => seg.toLowerCase() === ".git")) throw new GateError(`.git is off limits: ${abs}`);
  }
  return real;
}
async function walk(dir, out, limit) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (out.length >= limit) return;
    if (e.name.toLowerCase() === ".git" || e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, limit);
    else out.push(p);
  }
}

const ops = {
  read: {
    readFile: async (p) => fsp.readFile(gate(p, "read")),
    access: async (p) => fsp.access(gate(p, "read")),
  },
  write: {
    writeFile: async (p, content) => {
      const real = gate(p, "write");
      if (Buffer.byteLength(content) > 1024 * 1024) throw new GateError("file larger than 1 MB");
      await fsp.writeFile(real, content);
    },
    mkdir: async (d) => fsp.mkdir(gate(d, "write"), { recursive: true }),
  },
  edit: {
    readFile: async (p) => fsp.readFile(gate(p, "write")),
    writeFile: async (p, c) => fsp.writeFile(gate(p, "write"), c),
    access: async (p) => fsp.access(gate(p, "write")),
  },
  ls: {
    exists: (p) => { try { return fs.existsSync(gate(p, "read")); } catch { return false; } },
    stat: (p) => fs.statSync(gate(p, "read")),
    readdir: (p) => fs.readdirSync(gate(p, "read")).filter((n) => n.toLowerCase() !== ".git"),
  },
  find: {
    exists: (p) => { try { return fs.existsSync(gate(p, "read")); } catch { return false; } },
    glob: async (pattern, cwd, { limit }) => {
      const base = gate(cwd, "read");
      const files = [];
      await walk(base, files, 10_000);
      return files.filter((f) => path.matchesGlob(path.relative(base, f), pattern)).slice(0, limit);
    },
  },
  grep: {
    isDirectory: async (p) => (await fsp.stat(gate(p, "read"))).isDirectory(),
    readFile: async (p) => fsp.readFile(gate(p, "read"), "utf-8"),
  },
};

const tools = {
  read: pi.createReadToolDefinition(worktree, { operations: ops.read }),
  write: pi.createWriteToolDefinition(worktree, { operations: ops.write }),
  edit: pi.createEditToolDefinition(worktree, { operations: ops.edit }),
  ls: pi.createLsToolDefinition(worktree, { operations: ops.ls }),
  find: pi.createFindToolDefinition(worktree, { operations: ops.find }),
  grep: pi.createGrepToolDefinition(worktree, { operations: ops.grep }),
};

// ---- harness ------------------------------------------------------------------------------
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  cond ? pass++ : fail++;
};
async function run(tool, params) {
  try {
    const r = await tools[tool].execute("t1", params, undefined, undefined, undefined);
    const text = (r?.content ?? []).map((c) => c.text ?? "").join("\n");
    return { ok: true, text };
  } catch (e) {
    return { ok: false, text: String(e?.message ?? e) };
  }
}
const blocked = async (name, tool, params) => {
  const r = await run(tool, params);
  ok(name, !r.text.includes(SECRET) && (!r.ok || /outside|off limits|not found|Path not found|No files|ENOENT/i.test(r.text)), r.text.slice(0, 90).replace(/\n/g, " "));
};

console.log(`root: ${root}\n`);
console.log("-- read");
await blocked("read ~/secret.txt", "read", { path: "~/secret.txt" });
await blocked("read @~/secret.txt", "read", { path: "@~/secret.txt" });
await blocked(`read @${outside}/secret.txt`, "read", { path: `@${outside}/secret.txt` });
await blocked("read file:// URL", "read", { path: `file://${outside}/secret.txt` });
await blocked("read ../../outside/secret.txt", "read", { path: "../../outside/secret.txt" });
await blocked("read absolute outside path", "read", { path: `${outside}/secret.txt` });
await blocked("read with Unicode space (NBSP) in name", "read", { path: `${outside}/a b.txt` });
await blocked("read symlink file pointing outside", "read", { path: "link.md" });
await blocked("read through symlinked dir", "read", { path: "linkdir/secret.txt" });
await blocked("read .git", "read", { path: ".git" });
await blocked("read nested .GIT/config", "read", { path: "content/.GIT/config" });
let r = await run("read", { path: "index.md" });
ok("read index.md inside worktree works", r.ok && r.text.includes("hello"));
r = await run("read", { path: "@index.md" });
ok("read @index.md resolves inside worktree", r.ok && r.text.includes("hello"));
r = await run("read", { path: path.join(skillsDir, "site-editing", "SKILL.md") });
ok("read bundled skill file (read-only exception)", r.ok && r.text.includes("skill"));

console.log("-- write / edit");
r = await run("write", { path: "~/pwned.txt", content: "x" });
ok("write ~/pwned.txt blocked", !r.ok && !fs.existsSync(path.join(home, "pwned.txt")), r.text.slice(0, 80));
r = await run("write", { path: `file://${outside}/pwned.txt`, content: "x" });
ok("write file:// outside blocked", !r.ok && !fs.existsSync(path.join(outside, "pwned.txt")), r.text.slice(0, 80));
r = await run("write", { path: "linkdir/pwned.txt", content: "x" });
ok("write through symlinked dir blocked", !r.ok && !fs.existsSync(path.join(outside, "pwned.txt")), r.text.slice(0, 80));
r = await run("write", { path: path.join(skillsDir, "site-editing", "SKILL.md"), content: "x" });
ok("write into skills dir blocked", !r.ok && fs.readFileSync(path.join(skillsDir, "site-editing", "SKILL.md"), "utf8") === "# skill\n", r.text.slice(0, 80));
r = await run("write", { path: ".git/hooks/pre-commit", content: "x" });
ok("write .git/... blocked", !r.ok, r.text.slice(0, 80));
r = await run("write", { path: "content/deep/new/page.md", content: "# new\n" });
ok("write new deep file inside worktree works", r.ok && fs.existsSync(path.join(worktree, "content/deep/new/page.md")), r.text.slice(0, 80));
r = await run("write", { path: "big.md", content: "x".repeat(1024 * 1024 + 1) });
ok("write >1 MB blocked", !r.ok && !fs.existsSync(path.join(worktree, "big.md")), r.text.slice(0, 80));
r = await run("edit", { path: "~/secret.txt", edits: [{ oldText: SECRET, newText: "changed" }] });
ok("edit ~/secret.txt blocked", !r.ok && fs.readFileSync(path.join(home, "secret.txt"), "utf8") === SECRET, r.text.slice(0, 80));

console.log("-- ls / find / grep");
await blocked("ls ~", "ls", { path: "~" });
await blocked("ls outside dir", "ls", { path: outside });
r = await run("ls", { path: "." });
ok("ls . works and hides .git", r.ok && r.text.includes("index.md") && !/^\.git$/m.test(r.text), r.text.replace(/\n/g, " ").slice(0, 80));
await blocked("find in ~", "find", { pattern: "*.txt", path: "~" });
r = await run("find", { pattern: "**/*.md" });
ok("find **/*.md works, skips symlinks and .git", r.ok && r.text.includes("index.md") && !r.text.includes("link.md") && !r.text.includes(".GIT"), r.text.replace(/\n/g, " ").slice(0, 100));
await blocked("grep in ~", "grep", { pattern: "SECRET", path: "~" });
await blocked("grep in outside dir", "grep", { pattern: "SECRET", path: outside });
r = await run("grep", { pattern: "SECRET" });
ok("grep in worktree does not follow symlinks to secrets", !r.text.includes(SECRET), r.text.replace(/\n/g, " ").slice(0, 100));
r = await run("grep", { pattern: "hello" });
ok("grep in worktree finds content", r.ok && r.text.includes("index.md"), r.text.replace(/\n/g, " ").slice(0, 80));

// ---- tools allowlist vs customTools -------------------------------------------------------
console.log("-- createAgentSession tool registration");
const siteInfo = {
  name: "site_info", label: "site_info", description: "Return site info",
  parameters: { type: "object", properties: {} },
  execute: async () => ({ content: [{ type: "text", text: "info" }], details: undefined }),
};
const customTools = [...Object.values(tools), siteInfo];
async function names(opts) {
  try {
    const { session } = await pi.createAgentSession({
      cwd: worktree, agentDir, sessionManager: pi.SessionManager.inMemory(worktree), ...opts,
    });
    const active = session.getActiveToolNames();
    session.dispose?.();
    return active;
  } catch (e) {
    return `error: ${e?.message ?? e}`;
  }
}
const builtinOnly = await names({ tools: ["read", "grep", "find", "ls", "edit", "write"], customTools: [siteInfo] });
ok("control: built-in-only allowlist drops custom tool", Array.isArray(builtinOnly) && !builtinOnly.includes("site_info"), JSON.stringify(builtinOnly));
const withCustom = await names({ tools: ["read", "grep", "find", "ls", "edit", "write", "site_info"], customTools });
ok("allowlist incl. custom names registers site_info", Array.isArray(withCustom) && withCustom.includes("site_info"), JSON.stringify(withCustom));
ok("no bash in active tools", Array.isArray(withCustom) && !withCustom.includes("bash"));

// Which definition backs "read" when a custom tool shares the built-in name?
{
  const { session } = await pi.createAgentSession({
    cwd: worktree, agentDir, sessionManager: pi.SessionManager.inMemory(worktree),
    tools: ["read", "grep", "find", "ls", "edit", "write", "site_info"], customTools,
  });
  const reg = session._toolRegistry ?? session.toolRegistry;
  const all = session.getAllTools();
  const readInfo = all.find((t) => t.name === "read");
  console.log("  read tool info:", JSON.stringify(readInfo)?.slice(0, 200));
  const agentTools = session.agent?.state?.tools ?? [];
  const readTool = agentTools.find((t) => t.name === "read");
  if (readTool) {
    const res = await readTool.execute("t2", { path: "~/secret.txt" }).catch((e) => ({ error: String(e?.message ?? e) }));
    const txt = JSON.stringify(res);
    ok("session's active read tool is the gated one", !txt.includes(SECRET), txt.slice(0, 100));
  } else {
    console.log("  (could not reach agent.state.tools; registry keys:", reg ? Object.keys(reg).slice(0, 10) : "none", ")");
  }
  session.dispose?.();
}

console.log(`\npassed: ${pass}  failed: ${fail}`);
process.exit(fail ? 1 : 0);
