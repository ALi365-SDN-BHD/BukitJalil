// Explicit zero-inference protocol/sandbox probe. No turn/start, login or credential reads.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { CodexChat, verifyReadOnlyConfig } from "../src/main/codex";
import { CodexRpc } from "../src/main/codex-rpc";
import { editCopyNamespace, directCopyToolConfig } from "../src/main/generation";
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bukitjalil-generation-probe-")));
const chat = new CodexChat(root, () => null, () => {}, async () => {}, process.env.BUKITJALIL_CODEX_BIN);
let rpc: CodexRpc | undefined;
try {
  await chat.initialize(); await chat.connect();
  // Reuse only this instance's hardened process arguments; no renderer RPC bridge exists.
  const child = (chat as any).rpc.process.child;
  const env = Object.fromEntries(["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "CODEX_HOME"]
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  rpc = new CodexRpc(child.spawnfile, [...child.spawnargs.slice(2), "-c", directCopyToolConfig], root, env, () => {}, () => {});
  await rpc.request("initialize", { clientInfo: { name: "bukitjalil_probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  rpc.notify("initialized");
  verifyReadOnlyConfig((await rpc.request("config/read", { includeLayers: false })).config, true);
  const features = await rpc.request("experimentalFeature/list", { limit: 200 });
  assert.equal(features.nextCursor, null);
  assert.ok(features.data.filter((f: any) => ["code_mode", "code_mode_host", "code_mode_only"].includes(f.name)).every((f: any) => f.enabled === false));
  const copy = path.join(root, "copy"); await fs.mkdir(copy);
  const started = await rpc.request("thread/start", {
    cwd: copy, sandbox: "read-only", approvalPolicy: "never", approvalsReviewer: "user",
    baseInstructions: "No model turn. Protocol-only verification.", developerInstructions: "No model turn.",
    dynamicTools: [editCopyNamespace], environments: [], selectedCapabilityRoots: [], ephemeral: true,
  });
  assert.equal(started.sandbox.type, "readOnly");
  assert.equal(started.sandbox.networkAccess, false);
  assert.equal(started.approvalPolicy, "never");
  assert.equal(started.approvalsReviewer, "user");
  const statuses = await rpc.request("mcpServerStatus/list", { threadId: started.thread.id, limit: 100 });
  assert.equal(statuses.nextCursor, null);
  assert.ok(statuses.data.every((s: any) => !Object.keys(s.tools ?? {}).length && !s.resources?.length && !s.resourceTemplates?.length));
  for (const name of [path.join(copy, "native-write"), path.join(root, "formal-canary")]) {
    await fs.writeFile(name, "untouched");
    const result = await rpc.request("command/exec", {
      command: ["/usr/bin/touch", name], cwd: copy, timeoutMs: 5000,
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Operation not permitted|Permission denied/);
    const read = await rpc.request("command/exec", {
      command: ["/bin/cat", name], cwd: copy, timeoutMs: 5000,
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    });
    assert.equal(read.exitCode, 0); assert.equal(read.stdout, "untouched");
    assert.equal(await fs.readFile(name, "utf8"), "untouched");
  }
  console.log(JSON.stringify({ version: chat.state().version, modelTurns: 0,
    dynamicToolSchema: "namespaced tool accepted by native ephemeral thread; model invocation not tested",
    directNamespace: editCopyNamespace.name, codeModeEnabled: false, codeModeHostEnabled: false, externalTools: 0,
    sandbox: "readOnly", nativeCopyWrite: "denied", nativeOutsideWrite: "denied" }));
} finally { await rpc?.close(); await chat.dispose(); await fs.rm(root, { recursive: true, force: true }); }
