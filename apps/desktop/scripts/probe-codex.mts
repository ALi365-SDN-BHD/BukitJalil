// Opt-in real stdio/config/account handshake. Never calls turn/start or reads credentials.
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodexChat } from "../src/main/codex";
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bukitjalil-native-codex-")));
const chat = new CodexChat(root, () => null, () => {}, async () => {}, process.env.BUKITJALIL_CODEX_BIN);
try {
  await chat.initialize();
  await chat.connect();
  const state = chat.state();
  if (state.connection !== "ready") throw new Error("Codex did not become ready");
  console.log(JSON.stringify({
    version: state.version, connection: state.connection,
    accountType: state.account?.type ?? null,
    effectiveReadOnlyPolicy: "verified", modelTurns: 0,
  }));
} finally {
  await chat.dispose();
  await fs.rm(root, { recursive: true, force: true });
}
