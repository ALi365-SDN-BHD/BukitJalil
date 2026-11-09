// `pnpm dev`: start the server (tsx watch) and Vite together (plan 3.3).
// Vite gets an environment without BUKITJALIL_*_TOKEN and model keys, so it never sees secrets.
import { spawn } from "node:child_process";

const SECRET = /^(BUKITJALIL_.*_TOKEN|.*_API_KEY|.*_AUTH_TOKEN|NOTION_TOKEN|GITHUB_TOKEN|GH_TOKEN)$/;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const viteEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET.test(k)));

const children = [
  spawn(
    pnpm,
    [
      "--filter",
      "@bukitjalil/server",
      "exec",
      "tsx",
      "watch",
      "--clear-screen=false",
      "src/main.ts",
      "--dev-origin",
      "http://127.0.0.1:47890",
      "--no-open",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, BUKITJALIL_DEV: "1" },
    },
  ),
  spawn(pnpm, ["--filter", "@bukitjalil/web", "dev"], { stdio: "inherit", env: viteEnv }),
];

let exiting = false;
function stopAll(code) {
  if (exiting) return;
  exiting = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of children) child.on("exit", (code) => stopAll(code ?? 1));
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
