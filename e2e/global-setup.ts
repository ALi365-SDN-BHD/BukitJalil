import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { E2E_ADMIN_PORT, E2E_PREVIEW_BASE } from "./ports.ts";

/** Start the real server with a throwaway data dir and hand the token URL to the tests. */
export default async function globalSetup() {
  const root = path.resolve(import.meta.dirname, "..");
  if (!fs.existsSync(path.join(root, "packages/web/dist/index.html"))) {
    throw new Error("Build the UI first: pnpm build");
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bj-e2e-home-"));
  const child: ChildProcess = spawn(
    process.execPath,
    [
      path.join(root, "packages/server/node_modules/tsx/dist/cli.mjs"),
      path.join(root, "packages/server/src/main.ts"),
      "--no-open",
      "--port",
      String(E2E_ADMIN_PORT),
      "--preview-port-base",
      String(E2E_PREVIEW_BASE),
    ],
    { cwd: root, env: { ...process.env, BUKITJALIL_HOME: home }, stdio: ["ignore", "pipe", "pipe"] },
  );

  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 20_000);
    const onData = (d: Buffer) => {
      out += d.toString();
      const m = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)/.exec(out);
      if (m?.[1]) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => reject(new Error(`server exited with ${code}:\n${out}`)));
  });
  process.env.BJ_E2E_URL = url;

  return async () => {
    child.kill("SIGTERM");
    fs.rmSync(home, { recursive: true, force: true });
  };
}
